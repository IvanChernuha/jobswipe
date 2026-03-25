-- ─────────────────────────────────────────────
-- TAG SYSTEM
-- ─────────────────────────────────────────────

-- Tag categories
CREATE TYPE tag_category_enum AS ENUM (
  'language',
  'framework',
  'tool',
  'database',
  'cloud',
  'soft_skill',
  'certification',
  'other'
);

-- Master tags table
CREATE TABLE public.tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,          -- normalized lowercase display name
  category   tag_category_enum NOT NULL DEFAULT 'other',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_tags_category ON public.tags(category);
CREATE INDEX idx_tags_name     ON public.tags(name);

-- Worker ↔ Tag (many-to-many)
CREATE TABLE public.worker_tags (
  worker_id uuid NOT NULL REFERENCES public.worker_profiles(user_id) ON DELETE CASCADE,
  tag_id    uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (worker_id, tag_id)
);

CREATE INDEX idx_worker_tags_worker ON public.worker_tags(worker_id);
CREATE INDEX idx_worker_tags_tag    ON public.worker_tags(tag_id);

-- Job Posting ↔ Tag (many-to-many)
CREATE TABLE public.job_posting_tags (
  job_posting_id uuid NOT NULL REFERENCES public.job_postings(id) ON DELETE CASCADE,
  tag_id         uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (job_posting_id, tag_id)
);

CREATE INDEX idx_job_posting_tags_job ON public.job_posting_tags(job_posting_id);
CREATE INDEX idx_job_posting_tags_tag ON public.job_posting_tags(tag_id);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
ALTER TABLE public.tags             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_tags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_posting_tags ENABLE ROW LEVEL SECURITY;

-- Tags: anyone can read
CREATE POLICY "tags_read_all" ON public.tags FOR SELECT USING (true);

-- Worker tags: anyone auth'd can read, only owner can write
CREATE POLICY "worker_tags_read" ON public.worker_tags
  FOR SELECT USING (true);
CREATE POLICY "worker_tags_insert" ON public.worker_tags
  FOR INSERT WITH CHECK (auth.uid() = worker_id);
CREATE POLICY "worker_tags_delete" ON public.worker_tags
  FOR DELETE USING (auth.uid() = worker_id);

-- Job posting tags: anyone auth'd can read, only posting owner can write
CREATE POLICY "job_posting_tags_read" ON public.job_posting_tags
  FOR SELECT USING (true);
CREATE POLICY "job_posting_tags_insert" ON public.job_posting_tags
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.job_postings WHERE id = job_posting_id AND employer_id = auth.uid())
  );
CREATE POLICY "job_posting_tags_delete" ON public.job_posting_tags
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.job_postings WHERE id = job_posting_id AND employer_id = auth.uid())
  );

-- ─────────────────────────────────────────────
-- SEED DATA — ~300 common tech skills
-- ─────────────────────────────────────────────
INSERT INTO public.tags (name, category) VALUES
  -- Languages
  ('JavaScript', 'language'), ('TypeScript', 'language'), ('Python', 'language'),
  ('Java', 'language'), ('C#', 'language'), ('C++', 'language'),
  ('C', 'language'), ('Go', 'language'), ('Rust', 'language'),
  ('Ruby', 'language'), ('PHP', 'language'), ('Swift', 'language'),
  ('Kotlin', 'language'), ('Scala', 'language'), ('R', 'language'),
  ('Dart', 'language'), ('Elixir', 'language'), ('Haskell', 'language'),
  ('Lua', 'language'), ('Perl', 'language'), ('MATLAB', 'language'),
  ('SQL', 'language'), ('HTML', 'language'), ('CSS', 'language'),
  ('Bash', 'language'), ('PowerShell', 'language'), ('Objective-C', 'language'),
  ('Solidity', 'language'), ('VHDL', 'language'), ('Assembly', 'language'),
  ('Groovy', 'language'), ('Clojure', 'language'), ('F#', 'language'),
  ('Julia', 'language'), ('Zig', 'language'), ('OCaml', 'language'),

  -- Frameworks & Libraries
  ('React', 'framework'), ('Angular', 'framework'), ('Vue.js', 'framework'),
  ('Next.js', 'framework'), ('Nuxt.js', 'framework'), ('Svelte', 'framework'),
  ('Node.js', 'framework'), ('Express.js', 'framework'), ('NestJS', 'framework'),
  ('FastAPI', 'framework'), ('Django', 'framework'), ('Flask', 'framework'),
  ('Spring Boot', 'framework'), ('Rails', 'framework'), ('Laravel', 'framework'),
  ('ASP.NET', 'framework'), ('.NET', 'framework'), ('Blazor', 'framework'),
  ('React Native', 'framework'), ('Flutter', 'framework'), ('Ionic', 'framework'),
  ('Electron', 'framework'), ('Tauri', 'framework'), ('Qt', 'framework'),
  ('jQuery', 'framework'), ('Bootstrap', 'framework'), ('Tailwind CSS', 'framework'),
  ('Material UI', 'framework'), ('Chakra UI', 'framework'), ('Ant Design', 'framework'),
  ('Redux', 'framework'), ('MobX', 'framework'), ('Zustand', 'framework'),
  ('GraphQL', 'framework'), ('Apollo', 'framework'), ('tRPC', 'framework'),
  ('Prisma', 'framework'), ('Sequelize', 'framework'), ('SQLAlchemy', 'framework'),
  ('Hibernate', 'framework'), ('Entity Framework', 'framework'),
  ('TensorFlow', 'framework'), ('PyTorch', 'framework'), ('Keras', 'framework'),
  ('scikit-learn', 'framework'), ('Pandas', 'framework'), ('NumPy', 'framework'),
  ('OpenCV', 'framework'), ('Hugging Face', 'framework'), ('LangChain', 'framework'),
  ('Playwright', 'framework'), ('Cypress', 'framework'), ('Jest', 'framework'),
  ('Mocha', 'framework'), ('Pytest', 'framework'), ('JUnit', 'framework'),
  ('Selenium', 'framework'), ('Storybook', 'framework'),
  ('Phoenix', 'framework'), ('Gin', 'framework'), ('Echo', 'framework'),
  ('Fiber', 'framework'), ('Actix', 'framework'), ('Rocket', 'framework'),
  ('Unity', 'framework'), ('Unreal Engine', 'framework'), ('Godot', 'framework'),
  ('Three.js', 'framework'), ('D3.js', 'framework'), ('p5.js', 'framework'),
  ('Remix', 'framework'), ('Astro', 'framework'), ('Gatsby', 'framework'),
  ('Vite', 'framework'), ('Webpack', 'framework'), ('esbuild', 'framework'),
  ('Celery', 'framework'), ('Socket.IO', 'framework'),
  ('Deno', 'framework'), ('Bun', 'framework'), ('Hono', 'framework'),

  -- Tools & Platforms
  ('Git', 'tool'), ('GitHub', 'tool'), ('GitLab', 'tool'),
  ('Bitbucket', 'tool'), ('Jira', 'tool'), ('Confluence', 'tool'),
  ('Slack', 'tool'), ('VS Code', 'tool'), ('IntelliJ', 'tool'),
  ('Docker', 'tool'), ('Kubernetes', 'tool'), ('Terraform', 'tool'),
  ('Ansible', 'tool'), ('Jenkins', 'tool'), ('GitHub Actions', 'tool'),
  ('GitLab CI', 'tool'), ('CircleCI', 'tool'), ('Travis CI', 'tool'),
  ('ArgoCD', 'tool'), ('Helm', 'tool'), ('Prometheus', 'tool'),
  ('Grafana', 'tool'), ('Datadog', 'tool'), ('New Relic', 'tool'),
  ('Sentry', 'tool'), ('ELK Stack', 'tool'), ('Splunk', 'tool'),
  ('Nginx', 'tool'), ('Apache', 'tool'), ('Caddy', 'tool'),
  ('Linux', 'tool'), ('Windows Server', 'tool'), ('macOS', 'tool'),
  ('Figma', 'tool'), ('Sketch', 'tool'), ('Adobe XD', 'tool'),
  ('Photoshop', 'tool'), ('Illustrator', 'tool'),
  ('Postman', 'tool'), ('Insomnia', 'tool'), ('Swagger', 'tool'),
  ('npm', 'tool'), ('Yarn', 'tool'), ('pnpm', 'tool'),
  ('pip', 'tool'), ('Maven', 'tool'), ('Gradle', 'tool'),
  ('Cargo', 'tool'), ('Homebrew', 'tool'),
  ('Vercel', 'tool'), ('Netlify', 'tool'), ('Heroku', 'tool'),
  ('Render', 'tool'), ('Railway', 'tool'), ('Fly.io', 'tool'),
  ('Cloudflare', 'tool'), ('Fastly', 'tool'),
  ('OpenProject', 'tool'), ('Notion', 'tool'), ('Linear', 'tool'),
  ('Trello', 'tool'), ('Asana', 'tool'),
  ('HashiCorp Vault', 'tool'), ('Consul', 'tool'),
  ('RabbitMQ', 'tool'), ('Kafka', 'tool'), ('NATS', 'tool'),
  ('Stripe', 'tool'), ('Twilio', 'tool'), ('SendGrid', 'tool'),

  -- Databases
  ('PostgreSQL', 'database'), ('MySQL', 'database'), ('MariaDB', 'database'),
  ('SQLite', 'database'), ('Oracle DB', 'database'), ('SQL Server', 'database'),
  ('MongoDB', 'database'), ('DynamoDB', 'database'), ('Cassandra', 'database'),
  ('CouchDB', 'database'), ('Neo4j', 'database'), ('ArangoDB', 'database'),
  ('Redis', 'database'), ('Memcached', 'database'), ('Elasticsearch', 'database'),
  ('ClickHouse', 'database'), ('TimescaleDB', 'database'), ('InfluxDB', 'database'),
  ('Supabase', 'database'), ('Firebase', 'database'), ('PlanetScale', 'database'),
  ('CockroachDB', 'database'), ('Snowflake', 'database'), ('BigQuery', 'database'),
  ('Redshift', 'database'), ('Pinecone', 'database'), ('Weaviate', 'database'),
  ('Milvus', 'database'), ('pgvector', 'database'),

  -- Cloud & DevOps
  ('AWS', 'cloud'), ('Azure', 'cloud'), ('GCP', 'cloud'),
  ('DigitalOcean', 'cloud'), ('Linode', 'cloud'), ('Hetzner', 'cloud'),
  ('AWS Lambda', 'cloud'), ('AWS EC2', 'cloud'), ('AWS S3', 'cloud'),
  ('AWS RDS', 'cloud'), ('AWS ECS', 'cloud'), ('AWS EKS', 'cloud'),
  ('AWS CloudFormation', 'cloud'), ('AWS CDK', 'cloud'),
  ('Azure Functions', 'cloud'), ('Azure DevOps', 'cloud'),
  ('Google Cloud Functions', 'cloud'), ('Google Cloud Run', 'cloud'),
  ('Cloudflare Workers', 'cloud'), ('Serverless Framework', 'cloud'),
  ('CI/CD', 'cloud'), ('DevOps', 'cloud'), ('SRE', 'cloud'),
  ('Infrastructure as Code', 'cloud'), ('Microservices', 'cloud'),
  ('Service Mesh', 'cloud'), ('Istio', 'cloud'),

  -- Soft Skills
  ('Leadership', 'soft_skill'), ('Communication', 'soft_skill'),
  ('Problem Solving', 'soft_skill'), ('Teamwork', 'soft_skill'),
  ('Agile', 'soft_skill'), ('Scrum', 'soft_skill'),
  ('Kanban', 'soft_skill'), ('Project Management', 'soft_skill'),
  ('Mentoring', 'soft_skill'), ('Technical Writing', 'soft_skill'),
  ('Public Speaking', 'soft_skill'), ('Code Review', 'soft_skill'),
  ('System Design', 'soft_skill'), ('Architecture', 'soft_skill'),
  ('Product Management', 'soft_skill'), ('UX Design', 'soft_skill'),
  ('UI Design', 'soft_skill'), ('Data Analysis', 'soft_skill'),
  ('Machine Learning', 'soft_skill'), ('Deep Learning', 'soft_skill'),
  ('NLP', 'soft_skill'), ('Computer Vision', 'soft_skill'),
  ('Blockchain', 'soft_skill'), ('Web3', 'soft_skill'),
  ('Cybersecurity', 'soft_skill'), ('Penetration Testing', 'soft_skill'),
  ('DevSecOps', 'soft_skill'), ('Performance Optimization', 'soft_skill'),
  ('Accessibility', 'soft_skill'), ('SEO', 'soft_skill'),
  ('API Design', 'soft_skill'), ('Database Design', 'soft_skill'),
  ('ETL', 'soft_skill'), ('Data Engineering', 'soft_skill'),
  ('Data Science', 'soft_skill'), ('Business Intelligence', 'soft_skill'),
  ('Remote Work', 'soft_skill'), ('Startup Experience', 'soft_skill'),

  -- Certifications
  ('AWS Certified', 'certification'), ('Azure Certified', 'certification'),
  ('GCP Certified', 'certification'), ('Kubernetes Certified (CKA)', 'certification'),
  ('Terraform Certified', 'certification'), ('PMP', 'certification'),
  ('Scrum Master (CSM)', 'certification'), ('CISSP', 'certification'),
  ('CompTIA Security+', 'certification'), ('OSCP', 'certification'),
  ('Oracle Certified', 'certification'), ('Salesforce Certified', 'certification'),
  ('Cisco CCNA', 'certification'), ('Red Hat Certified', 'certification')

ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────
-- MIGRATE EXISTING DATA
-- Auto-link existing workers' text skills to tags
-- ─────────────────────────────────────────────
INSERT INTO public.worker_tags (worker_id, tag_id)
SELECT wp.user_id, t.id
FROM public.worker_profiles wp,
     LATERAL unnest(wp.skills) AS skill_text
JOIN public.tags t ON lower(trim(skill_text)) = lower(t.name)
ON CONFLICT DO NOTHING;

-- Auto-link existing job postings' text skills to tags
INSERT INTO public.job_posting_tags (job_posting_id, tag_id)
SELECT jp.id, t.id
FROM public.job_postings jp,
     LATERAL unnest(jp.skills_required) AS skill_text
JOIN public.tags t ON lower(trim(skill_text)) = lower(t.name)
ON CONFLICT DO NOTHING;
