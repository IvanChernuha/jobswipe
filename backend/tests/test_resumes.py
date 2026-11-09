"""A fresh, short-lived link to a worker's CV (the stored one expires)."""
from app.services.resumes import RESUME_LINK_SECONDS, fresh_resume_url


class FakeBucket:
    def __init__(self, files):
        self.files = files
        self.signed = []

    def list(self, folder):
        return [{"name": n} for n in self.files.get(folder, [])]

    def create_signed_url(self, path, seconds):
        self.signed.append((path, seconds))
        return {"signedURL": f"/storage/v1/object/sign/resumes/{path}?token=t"}


class FakeStorage:
    def __init__(self, bucket):
        self.bucket = bucket

    def from_(self, name):
        assert name == "resumes"
        return self.bucket


class FakeClient:
    def __init__(self, files):
        self.storage = FakeStorage(FakeBucket(files))


def test_signs_the_workers_cv_for_a_short_time():
    client = FakeClient({"resumes/w1": ["resume.pdf"]})
    url = fresh_resume_url("w1", client=client)
    assert client.storage.bucket.signed == [("resumes/w1/resume.pdf", RESUME_LINK_SECONDS)]
    assert url.endswith("/storage/v1/object/sign/resumes/resumes/w1/resume.pdf?token=t")
    assert RESUME_LINK_SECONDS <= 3600


def test_no_cv_gives_none():
    assert fresh_resume_url("w2", client=FakeClient({})) is None


def test_ignores_other_files_in_the_folder():
    client = FakeClient({"resumes/w3": [".emptyFolderPlaceholder", "resume.docx"]})
    fresh_resume_url("w3", client=client)
    assert client.storage.bucket.signed[0][0] == "resumes/w3/resume.docx"
