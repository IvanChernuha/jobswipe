"""Keep trying to launch the Always Free Ampere A1 instance until Oracle has capacity.

Free A1 capacity in small regions (Jerusalem has a single AD) is often exhausted,
and the console just says "Out of host capacity". This retries the launch on an
interval and stops as soon as one instance exists.

Safety: before EVERY attempt it lists the tenancy's instances and exits if any
non-terminated A1 instance already exists, so it can never create a second
(billable) one. Do not click "Create" in the console while this is running.

Usage (no local pip needed — runs in a throwaway Python container):

    docker run -d --name oci-grab --restart on-failure:5 \
      -v ~/.oci:/root/.oci:ro \
      -v ~/.ssh/oracle_jobswipe.pub:/ssh.pub:ro \
      -v "$PWD/scripts/oracle:/app:ro" \
      python:3.12-slim sh -c "pip install -q oci && python -u /app/grab_a1.py"

    docker logs -f oci-grab          # watch progress

Append --check to the python command (with `docker run --rm` instead of -d) to
verify auth, limits, image and network without launching anything.

Exit code 0 = instance exists (done); non-zero = fatal (limit/auth) — the
restart cap keeps fatal errors from looping forever.

Requires ~/.oci/config ([DEFAULT] profile) and an API key uploaded in the console.
"""

import random
import sys
import time

import oci
from oci.core import models as m

DISPLAY_NAME = "jobswipe"
SHAPE = "VM.Standard.A1.Flex"
OCPUS = 2
MEMORY_GB = 12
BOOT_GB = 100
OS_NAME = "Canonical Ubuntu"
OS_VERSION = "24.04"
SSH_PUB_PATH = "/ssh.pub"
OPEN_PORTS = (80, 443)

RETRY_SECONDS = 60
THROTTLED_SECONDS = 300


def log(msg):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def existing_a1(compute, compartment_id):
    instances = oci.pagination.list_call_get_all_results(
        compute.list_instances, compartment_id=compartment_id
    ).data
    return [i for i in instances if i.shape == SHAPE and i.lifecycle_state != "TERMINATED"]


def pick_image(compute, compartment_id):
    images = compute.list_images(
        compartment_id,
        operating_system=OS_NAME,
        operating_system_version=OS_VERSION,
        shape=SHAPE,
        sort_by="TIMECREATED",
        sort_order="DESC",
    ).data
    if not images:
        sys.exit(f"No {OS_NAME} {OS_VERSION} image compatible with {SHAPE} in this region")
    # Prefer the full image over Minimal; both are aarch64 given the shape filter.
    full = [i for i in images if "Minimal" not in i.display_name]
    return (full or images)[0]


def ensure_ports(vn, security_list_id):
    sl = vn.get_security_list(security_list_id).data
    have = {
        r.tcp_options.destination_port_range.min
        for r in sl.ingress_security_rules
        if r.protocol == "6" and r.source == "0.0.0.0/0"
        and r.tcp_options and r.tcp_options.destination_port_range
        and r.tcp_options.destination_port_range.min == r.tcp_options.destination_port_range.max
    }
    missing = [p for p in OPEN_PORTS if p not in have]
    if not missing:
        return
    rules = list(sl.ingress_security_rules) + [
        m.IngressSecurityRule(
            protocol="6",
            source="0.0.0.0/0",
            source_type="CIDR_BLOCK",
            tcp_options=m.TcpOptions(destination_port_range=m.PortRange(min=p, max=p)),
        )
        for p in missing
    ]
    vn.update_security_list(
        security_list_id,
        m.UpdateSecurityListDetails(
            ingress_security_rules=rules, egress_security_rules=sl.egress_security_rules
        ),
    )
    log(f"Opened TCP {missing} in security list {sl.display_name}")


def ensure_public_subnet(vn, compartment_id):
    """Reuse any public subnet (e.g. one the console wizard made), else build a VCN."""
    subnets = vn.list_subnets(compartment_id).data
    public = [s for s in subnets if not s.prohibit_public_ip_on_vnic and s.lifecycle_state == "AVAILABLE"]
    if public:
        subnet = public[0]
        log(f"Using existing public subnet {subnet.display_name}")
    else:
        log("No public subnet found — creating VCN, internet gateway and subnet")
        vcn = vn.create_vcn(m.CreateVcnDetails(
            compartment_id=compartment_id, cidr_blocks=["10.0.0.0/16"],
            display_name="jobswipe-vcn", dns_label="jobswipe",
        )).data
        vcn = oci.wait_until(vn, vn.get_vcn(vcn.id), "lifecycle_state", "AVAILABLE").data
        igw = vn.create_internet_gateway(m.CreateInternetGatewayDetails(
            compartment_id=compartment_id, vcn_id=vcn.id, is_enabled=True,
            display_name="jobswipe-igw",
        )).data
        oci.wait_until(vn, vn.get_internet_gateway(igw.id), "lifecycle_state", "AVAILABLE")
        vn.update_route_table(vcn.default_route_table_id, m.UpdateRouteTableDetails(route_rules=[
            m.RouteRule(destination="0.0.0.0/0", destination_type="CIDR_BLOCK", network_entity_id=igw.id),
        ]))
        subnet = vn.create_subnet(m.CreateSubnetDetails(
            compartment_id=compartment_id, vcn_id=vcn.id, cidr_block="10.0.0.0/24",
            display_name="jobswipe-public", dns_label="public",
            prohibit_public_ip_on_vnic=False,
            route_table_id=vcn.default_route_table_id,
            security_list_ids=[vcn.default_security_list_id],
        )).data
        subnet = oci.wait_until(vn, vn.get_subnet(subnet.id), "lifecycle_state", "AVAILABLE").data
    for sl_id in subnet.security_list_ids[:1]:
        ensure_ports(vn, sl_id)
    return subnet


def print_limits(config, compartment_id, ad):
    limits = oci.limits.LimitsClient(config)
    for name in ("standard-a1-core-count", "standard-a1-memory-count"):
        try:
            r = limits.get_resource_availability(
                "compute", name, compartment_id, availability_domain=ad
            ).data
            log(f"Limit {name}: used={r.used} available={r.available}")
        except oci.exceptions.ServiceError as e:
            log(f"Limit {name}: could not read ({e.code})")


def public_ip(compute, vn, compartment_id, instance_id):
    att = compute.list_vnic_attachments(compartment_id, instance_id=instance_id).data
    return vn.get_vnic(att[0].vnic_id).data.public_ip if att else None


def main():
    check_only = "--check" in sys.argv
    config = oci.config.from_file()
    oci.config.validate_config(config)
    compartment_id = config["tenancy"]

    identity = oci.identity.IdentityClient(config)
    compute = oci.core.ComputeClient(config)
    vn = oci.core.VirtualNetworkClient(config)

    ad = identity.list_availability_domains(compartment_id).data[0].name
    log(f"Region {config['region']}, AD {ad}")
    print_limits(config, compartment_id, ad)

    found = existing_a1(compute, compartment_id)
    if found:
        i = found[0]
        log(f"A1 instance already exists: {i.display_name} ({i.lifecycle_state}) — nothing to do")
        log(f"PUBLIC_IP={public_ip(compute, vn, compartment_id, i.id)}")
        return

    image = pick_image(compute, compartment_id)
    log(f"Image {image.display_name}")
    subnet = ensure_public_subnet(vn, compartment_id)

    if check_only:
        log("Check OK — not launching (--check)")
        return

    with open(SSH_PUB_PATH) as f:
        ssh_key = f.read().strip()

    details = m.LaunchInstanceDetails(
        availability_domain=ad,
        compartment_id=compartment_id,
        display_name=DISPLAY_NAME,
        shape=SHAPE,
        shape_config=m.LaunchInstanceShapeConfigDetails(ocpus=OCPUS, memory_in_gbs=MEMORY_GB),
        source_details=m.InstanceSourceViaImageDetails(image_id=image.id, boot_volume_size_in_gbs=BOOT_GB),
        create_vnic_details=m.CreateVnicDetails(subnet_id=subnet.id, assign_public_ip=True),
        metadata={"ssh_authorized_keys": ssh_key},
    )

    attempt = 0
    while True:
        attempt += 1
        if existing_a1(compute, compartment_id):
            log("An A1 instance appeared (created elsewhere?) — stopping to avoid a duplicate")
            return
        try:
            instance = compute.launch_instance(details).data
        except oci.exceptions.ServiceError as e:
            if e.status == 500 and "capacity" in (e.message or "").lower():
                wait = RETRY_SECONDS + random.randint(0, 15)
                log(f"#{attempt} out of host capacity — retrying in {wait}s")
            elif e.status == 429:
                wait = THROTTLED_SECONDS
                log(f"#{attempt} throttled — backing off {wait}s")
            elif e.code == "LimitExceeded":
                sys.exit(f"Service limit hit: {e.message}. Upgrade to Pay As You Go or request a limit increase.")
            elif e.status in (401, 404):
                sys.exit(f"Auth/permission error {e.status} {e.code}: {e.message}")
            else:
                wait = RETRY_SECONDS
                log(f"#{attempt} unexpected {e.status} {e.code}: {e.message} — retrying in {wait}s")
            time.sleep(wait)
            continue
        except Exception as e:  # network blips etc.
            log(f"#{attempt} {type(e).__name__}: {e} — retrying in {RETRY_SECONDS}s")
            time.sleep(RETRY_SECONDS)
            continue

        log(f"Launched {instance.id} after {attempt} attempt(s) — waiting for RUNNING")
        oci.wait_until(compute, compute.get_instance(instance.id), "lifecycle_state", "RUNNING",
                       max_wait_seconds=900)
        log(f"RUNNING. PUBLIC_IP={public_ip(compute, vn, compartment_id, instance.id)}")
        return


if __name__ == "__main__":
    main()
