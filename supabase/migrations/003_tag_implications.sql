-- ─────────────────────────────────────────────
-- TAG IMPLICATIONS (shadow tags for smart matching)
-- ─────────────────────────────────────────────

-- If a user has tag A, they implicitly also have tags B, C, D.
-- Shadow tags are NOT shown on profiles — only used for match scoring.
CREATE TABLE public.tag_implications (
  parent_tag_id  uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  implied_tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (parent_tag_id, implied_tag_id),
  CHECK (parent_tag_id != implied_tag_id)
);

CREATE INDEX idx_tag_implications_parent ON public.tag_implications(parent_tag_id);

-- RLS: readable by everyone (public data), only service role can write
ALTER TABLE public.tag_implications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read tag implications" ON public.tag_implications
  FOR SELECT USING (true);

-- ─────────────────────────────────────────────
-- Seed implications: framework/tool → language & concepts
-- ─────────────────────────────────────────────
-- Helper: insert implication by tag names
DO $$
DECLARE
  _parent_id uuid;
  _implied_id uuid;
BEGIN
  -- Helper function-like block for bulk inserts
  -- Format: (parent_name, implied_name)

  -- JavaScript frameworks → JavaScript
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('React', 'Vue.js', 'Angular', 'Svelte', 'jQuery', 'Next.js', 'Nuxt.js',
                      'Gatsby', 'Remix', 'Express.js', 'NestJS', 'Node.js', 'Bun', 'Deno',
                      'D3.js', 'Three.js', 'p5.js', 'Socket.IO', 'Redux', 'MobX', 'Zustand',
                      'Apollo', 'Electron', 'Tauri', 'React Native', 'Ionic')
      AND i.name = 'JavaScript'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- TypeScript frameworks → TypeScript
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('Angular', 'Next.js', 'NestJS', 'Remix', 'Astro', 'tRPC', 'Prisma')
      AND i.name = 'TypeScript'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- TypeScript → JavaScript
  SELECT id INTO _parent_id FROM public.tags WHERE name = 'TypeScript';
  SELECT id INTO _implied_id FROM public.tags WHERE name = 'JavaScript';
  IF _parent_id IS NOT NULL AND _implied_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Python frameworks → Python
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('Django', 'Flask', 'FastAPI', 'Celery', 'NumPy', 'Pandas', 'scikit-learn',
                      'PyTorch', 'TensorFlow', 'Keras', 'OpenCV', 'Hugging Face', 'LangChain',
                      'SQLAlchemy', 'Pytest', 'Selenium')
      AND i.name = 'Python'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Java frameworks → Java
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('Spring Boot', 'Hibernate', 'JUnit', 'Maven', 'Gradle')
      AND i.name = 'Java'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Ruby frameworks → Ruby
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'Rails' AND i.name = 'Ruby';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Go frameworks → Go
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('Gin', 'Fiber', 'Echo')
      AND i.name = 'Go'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Rust frameworks → Rust
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('Actix', 'Rocket', 'Tauri')
      AND i.name = 'Rust'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- PHP frameworks → PHP
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'Laravel' AND i.name = 'PHP';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Elixir frameworks → Elixir
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'Phoenix' AND i.name = 'Elixir';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;

  -- C# frameworks → C#
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('.NET', 'ASP.NET', 'Entity Framework', 'Blazor', 'Unity')
      AND i.name = 'C#'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Dart frameworks → Dart
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'Flutter' AND i.name = 'Dart';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Kotlin → Java (closely related)
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'Kotlin' AND i.name = 'Java';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Docker / K8s → DevOps
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('Docker', 'Kubernetes', 'Helm', 'ArgoCD', 'Istio')
      AND i.name = 'DevOps'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Kubernetes → Docker
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'Kubernetes' AND i.name = 'Docker';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;

  -- CI/CD tools → CI/CD
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('GitHub Actions', 'GitLab CI', 'Jenkins', 'CircleCI', 'Travis CI', 'ArgoCD')
      AND i.name = 'CI/CD'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- IaC tools → Infrastructure as Code
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('Terraform', 'Ansible', 'AWS CDK', 'AWS CloudFormation')
      AND i.name = 'Infrastructure as Code'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- SQL databases → SQL
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('PostgreSQL', 'MySQL', 'MariaDB', 'SQLite', 'SQL Server', 'Oracle DB',
                      'CockroachDB', 'PlanetScale', 'TimescaleDB', 'Supabase', 'Redshift',
                      'Snowflake', 'BigQuery', 'ClickHouse')
      AND i.name = 'SQL'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Supabase → PostgreSQL
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'Supabase' AND i.name = 'PostgreSQL';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;

  -- AWS services → AWS
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('AWS CDK', 'AWS CloudFormation', 'AWS EC2', 'AWS ECS', 'AWS EKS',
                      'AWS Lambda', 'AWS RDS', 'AWS S3')
      AND i.name = 'AWS'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Azure services → Azure
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('Azure DevOps', 'Azure Functions')
      AND i.name = 'Azure'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Google Cloud services → GCP
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('Google Cloud Functions', 'Google Cloud Run', 'Firebase', 'BigQuery')
      AND i.name = 'GCP'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- ML/AI → Data Science
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('Machine Learning', 'Deep Learning', 'NLP', 'Computer Vision')
      AND i.name = 'Data Science'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- ML frameworks → Machine Learning
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('TensorFlow', 'PyTorch', 'Keras', 'scikit-learn', 'Hugging Face', 'OpenCV')
      AND i.name = 'Machine Learning'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Monitoring → DevOps
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('Prometheus', 'Grafana', 'Datadog', 'New Relic', 'Sentry', 'Splunk', 'ELK Stack')
      AND i.name = 'DevOps'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Git tools → Git
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('GitHub', 'GitLab', 'Bitbucket', 'GitHub Actions', 'GitLab CI')
      AND i.name = 'Git'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Scrum Master cert → Scrum + Agile
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'Scrum Master (CSM)' AND i.name = 'Scrum';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'Scrum Master (CSM)' AND i.name = 'Agile';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Scrum → Agile
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'Scrum' AND i.name = 'Agile';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Kanban → Agile
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'Kanban' AND i.name = 'Agile';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;

  -- CSS frameworks → CSS
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('Tailwind CSS', 'Bootstrap', 'Chakra UI', 'Material UI', 'Ant Design')
      AND i.name = 'CSS'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Frontend frameworks → HTML
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('React', 'Vue.js', 'Angular', 'Svelte', 'Next.js', 'Nuxt.js', 'Astro', 'Gatsby', 'Remix')
      AND i.name = 'HTML'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Frontend frameworks → CSS
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('React', 'Vue.js', 'Angular', 'Svelte', 'Next.js', 'Nuxt.js', 'Astro', 'Gatsby', 'Remix')
      AND i.name = 'CSS'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Serverless tools → Serverless Framework concept (AWS Lambda, etc → Serverless)
  FOR _parent_id, _implied_id IN
    SELECT p.id, i.id FROM public.tags p, public.tags i
    WHERE p.name IN ('AWS Lambda', 'Azure Functions', 'Google Cloud Functions', 'Cloudflare Workers')
      AND i.name = 'Serverless Framework'
  LOOP
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Cert → cloud provider
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'AWS Certified' AND i.name = 'AWS';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'Azure Certified' AND i.name = 'Azure';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'GCP Certified' AND i.name = 'GCP';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'Terraform Certified' AND i.name = 'Terraform';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;
  SELECT p.id, i.id INTO _parent_id, _implied_id FROM public.tags p, public.tags i
    WHERE p.name = 'Kubernetes Certified (CKA)' AND i.name = 'Kubernetes';
  IF _parent_id IS NOT NULL THEN
    INSERT INTO public.tag_implications VALUES (_parent_id, _implied_id) ON CONFLICT DO NOTHING;
  END IF;

END $$;
