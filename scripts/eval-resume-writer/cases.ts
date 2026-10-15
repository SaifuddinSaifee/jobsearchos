import { emptyRecord, mergeProvenance, type CareerRecord, type Role } from "@/lib/career/schema";
import type { Profile } from "@/lib/profile/schema";
import type { JobInput } from "@/lib/resume-writer/context";

// Five synthetic candidates, each with a job to write for, chosen to differ in field, seniority and shape: an engineer
// with a second (product) telling of the same role, a product manager, an ML engineer with research work, a designer,
// and a teacher moving into instructional design. All names, employers and numbers are invented.

export type EvalCase = {
  id: string;
  /** One line on what the case tests. */
  about: string;
  record: CareerRecord;
  job: JobInput;
  contact: Profile["contact"];
  /** What the user ticks on the review screen on top of the defaults: a condition to mention, an interest with its note. */
  ticks: { match: RegExp; note?: string }[];
};

const tracked = (source: string) => ({ sources: [{ sourceId: source, blockId: null }], provenance: mergeProvenance() });
const SOURCE = "00000000-0000-4000-8000-000000000001";
/** Another document's source, for the second telling of a role: the framing filter keeps the tellings apart by it. */
const ALT_SOURCE = "00000000-0000-4000-8000-000000000002";

type Telling = { title: string; angle: string; facts: string[] };
type RoleSpec = { id: string; employer: string; start: string; end: string; location: string; main: Telling; alt?: Telling; plain?: string[] };

function role(spec: RoleSpec): Role {
  const framings = [{ id: `${spec.id}-f1`, title: spec.main.title, angle: spec.main.angle, targetRoles: [], ...tracked(SOURCE) }];
  if (spec.alt) framings.push({ id: `${spec.id}-f2`, title: spec.alt.title, angle: spec.alt.angle, targetRoles: [], ...tracked(ALT_SOURCE) });
  let n = 0;
  const fact = (text: string, framingId: string | null, source: string) => {
    const id = `${spec.id}-x${++n}`;
    return { id, provenance: mergeProvenance(), wordings: [{ id: `${id}w`, text, framingId, form: "bullet" as const, ...tracked(source) }] };
  };
  return {
    id: spec.id,
    start: spec.start,
    end: spec.end,
    current: spec.end === "",
    location: spec.location,
    dateNotes: [],
    framings,
    facts: [
      ...spec.main.facts.map((t) => fact(t, `${spec.id}-f1`, SOURCE)),
      ...(spec.alt?.facts ?? []).map((t) => fact(t, `${spec.id}-f2`, ALT_SOURCE)),
      ...(spec.plain ?? []).map((t) => fact(t, null, SOURCE)),
    ],
    ...tracked(SOURCE),
  };
}

type Extras = {
  skills: [category: string, names: string[]][];
  projects?: { name: string; description: string; url?: string; technologies: string[]; text: string }[];
  education: { institution: string; degree: string; field: string; start: string; end: string; details?: string }[];
  certifications?: { name: string; issuer: string; date?: string }[];
  achievements?: string[];
};

function record(roles: RoleSpec[], extras: Extras): CareerRecord {
  const byEmployer = new Map<string, RoleSpec[]>();
  for (const r of roles) byEmployer.set(r.employer, [...(byEmployer.get(r.employer) ?? []), r]);
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  return {
    ...emptyRecord(),
    employers: [...byEmployer].map(([name, list]) => ({ id: id("e"), name, companyId: null, names: [name], roles: list.map(role), ...tracked(SOURCE) })),
    skills: extras.skills.flatMap(([category, names]) => names.map((name) => ({ id: id("k"), name, category, ...tracked(SOURCE) }))),
    projects: (extras.projects ?? []).map((p) => {
      const pid = id("p");
      return { id: pid, name: p.name, description: p.description, url: p.url ?? "", technologies: p.technologies, wordings: [{ id: `${pid}w`, text: p.text, framingId: null, form: "bullet" as const, ...tracked(SOURCE) }], ...tracked(SOURCE) };
    }),
    education: extras.education.map((e) => ({ id: id("ed"), details: "", ...e, ...tracked(SOURCE) })),
    certifications: (extras.certifications ?? []).map((c) => ({ id: id("c"), date: "", ...c, ...tracked(SOURCE) })),
    achievements: (extras.achievements ?? []).map((text) => ({ id: id("a"), text, ...tracked(SOURCE) })),
  };
}

const contact = (name: string, email: string, location: string, links: string[] = []): Profile["contact"] => ({ name, email, phone: "555 0100", location, links });

export const CASES: EvalCase[] = [
  {
    id: "backend-storytelling",
    about: "Backend engineer with a product telling of the same role, writing for a consumer storytelling app; relocation and an interest ticked",
    contact: contact("Sam Rivera", "sam@example.com", "Austin, TX", ["https://github.com/samrivera"]),
    ticks: [{ match: /relocate/i }, { match: /fandom|fanfiction/i, note: "AO3 reader since 2016, mostly fantasy" }],
    record: record(
      [
        {
          id: "r1", employer: "Acme Payments", start: "Jan 2021", end: "", location: "Austin, TX",
          main: { title: "Software Engineer", angle: "Engineering", facts: [
            "Built Python ETL pipelines and backend APIs that pull from Stripe, Zendesk and Mixpanel and process 500K+ daily events at 99.9% uptime",
            "Designed the PostgreSQL schemas with Redis caching that cut query times by 60%",
            "Led the move from cron jobs to an event-driven refund pipeline on Kafka, cutting refund errors by 65%",
            "Turned a multi-hour release process into one click with a GitHub Actions and OpenAI workflow that drafts release notes and publishes them after approval in a Slack modal",
            "Designed the REST API for the merchant dashboard, used by 300 daily active merchants",
            "Mentored four junior engineers, two of whom were promoted within a year",
          ] },
          alt: { title: "Product Manager", angle: "Product", facts: [
            "Applied RICE scoring and VoC analysis to prioritise the backlog, lifting NPS by 24% in two quarters",
            "Wrote PRDs and user stories for the payouts roadmap and kept a 95% sprint completion rate",
          ] },
        },
        {
          id: "r2", employer: "Initech", start: "Jun 2018", end: "Dec 2020", location: "Dallas, TX",
          main: { title: "Developer", angle: "Engineering", facts: [
            "Wrote internal reporting tools in SQL and Python that replaced a weekly manual spreadsheet process",
            "Moved the nightly data job to a queue, reducing its runtime from 3 hours to 25 minutes",
            "Supported the on-call rotation for a service with 99.9% uptime",
          ] },
        },
      ],
      {
        skills: [["Languages", ["TypeScript", "Python", "SQL"]], ["Infrastructure", ["AWS (EC2, S3, Lambda)", "Docker", "PostgreSQL", "Kafka", "Redis"]]],
        projects: [{ name: "Paperchase", description: "A multi-tenant SaaS for chasing documents", url: "https://github.com/samrivera/paperchase", technologies: ["Next.js", "TypeScript", "PostgreSQL"], text: "Built a multi-tenant SaaS in Next.js and PostgreSQL that chases external documents to completion: account-free links, per-item review and reminders that name only what is missing. Covered by 248 automated tests." }],
        education: [{ institution: "State University of Technology", degree: "Bachelor of Technology", field: "Computer Engineering", start: "2014", end: "2018" }],
        certifications: [{ name: "AWS Certified AI Practitioner", issuer: "Amazon Web Services" }],
        achievements: ["Smart India Hackathon '22 (Winner)", "MumbaiHacks '23 (GenAI Track winner)"],
      },
    ),
    job: {
      title: "Software Engineer", company: "Fableloop", location: "San Francisco, CA",
      aboutCompany: "Our mission at Fableloop is to create the most entertaining storyteller in the world, and give it to everyone.",
      responsibilities: ["Build and operate the infrastructure behind our personalized recommendation system", "Ship consumer-facing features across mobile and web"],
      requirements: {
        required: ["1+ years of experience", "You've built actual infrastructure (not just pushed to Vercel)", "You've worked at a startup or built meaningful side projects", "You're willing to relocate to San Francisco"],
        preferred: ["Optional: you're into fandom, reading, games, or fanfiction"],
      },
      technologies: ["Vercel", "GitHub", "AI", "Machine learning", "Recommender systems"],
      keywords: ["Infrastructure", "Model training", "Inference", "Consumer apps", "Books apps", "Community-created stories", "Mobile application development", "Ownership", "Adaptability"],
      companyProfile: null,
    },
  },
  {
    id: "pm-b2b-saas",
    about: "Product manager from fintech writing for a senior PM role at a B2B workflow SaaS; strong numbers, no interests",
    contact: contact("Priya Natarajan", "priya@example.com", "Chicago, IL", ["https://www.linkedin.com/in/priyanatarajan"]),
    ticks: [],
    record: record(
      [
        {
          id: "r1", employer: "Ledgerly", start: "Mar 2021", end: "", location: "Chicago, IL",
          main: { title: "Product Manager", angle: "Product", facts: [
            "Owned the invoicing product for 4,000 small-business customers; grew paid adoption from 18% to 31% in a year",
            "Ran 40+ customer interviews and turned them into a reworked onboarding flow that cut time to first invoice from 3 days to 6 hours",
            "Launched automated payment reminders with the payments and data teams, recovering $2.1M in late invoices in the first two quarters",
            "Set up the quarterly planning process with engineering and design leads, using RICE scoring and a public roadmap in Productboard",
            "Wrote the PRD and pricing analysis for a usage-based tier that became 22% of new revenue",
            "Partnered with sales on 12 enterprise pilots and fed their requests into the roadmap",
          ] },
        },
        {
          id: "r2", employer: "Northwind Consulting", start: "Jul 2017", end: "Feb 2021", location: "Chicago, IL",
          main: { title: "Business Analyst", angle: "Business", facts: [
            "Mapped the order-to-cash process for a retail client across 5 departments and wrote the requirements for its ERP rollout",
            "Built SQL and Tableau dashboards that the client's finance team used for weekly cash forecasting",
            "Ran user acceptance testing for 3 releases with 60 testers across two time zones",
          ] },
        },
      ],
      {
        skills: [["Product", ["Roadmapping", "RICE", "User research", "A/B testing", "Pricing"]], ["Tools", ["Productboard", "Jira", "Amplitude", "SQL", "Tableau", "Figma"]]],
        education: [{ institution: "University of Illinois Urbana-Champaign", degree: "Bachelor of Science", field: "Industrial Engineering", start: "2013", end: "2017" }],
        certifications: [{ name: "Certified Scrum Product Owner", issuer: "Scrum Alliance", date: "2020" }],
      },
    ),
    job: {
      title: "Senior Product Manager, Workflow Automation", company: "Relaywork", location: "Remote (US)",
      aboutCompany: "Relaywork helps operations teams automate approvals and handoffs across the tools they already use.",
      responsibilities: ["Own the roadmap for the workflow builder", "Work with engineering and design to ship features that cut manual work for operations teams", "Talk to customers every week and turn what you learn into product decisions", "Define success metrics and report on them"],
      requirements: {
        required: ["5+ years of product management experience", "Experience shipping B2B SaaS products", "Strong analytical skills; comfortable with SQL", "Track record of working closely with engineering and design", "Experience with pricing and packaging"],
        preferred: ["Experience with workflow automation or integrations platforms", "Experience selling to enterprise customers"],
      },
      technologies: ["SQL", "Amplitude", "Jira"],
      keywords: ["B2B SaaS", "Workflow automation", "Product discovery", "Experimentation", "Stakeholder management", "Enterprise", "Customer empathy"],
      companyProfile: { about: "", principles: "- Customers first\n- Ship small, learn fast\n- Write it down" },
    },
  },
  {
    id: "ml-health-imaging",
    about: "Data scientist with research work writing for an ML engineer role at a medical imaging startup; tools gaps assumed",
    contact: contact("Daniel Okafor", "daniel@example.com", "Boston, MA", ["https://github.com/dokafor"]),
    ticks: [],
    record: record(
      [
        {
          id: "r1", employer: "Shelfwise", start: "Aug 2022", end: "", location: "Boston, MA",
          main: { title: "Data Scientist", angle: "Data", facts: [
            "Built a demand forecasting model in PyTorch for 1,200 stores that cut stockouts by 17%",
            "Moved model training from notebooks to scheduled Airflow pipelines with MLflow tracking",
            "Deployed the forecasting service on AWS SageMaker behind a FastAPI endpoint, serving 30K predictions a day",
            "Designed the A/B test framework the merchandising team uses to judge promotions",
            "Cut GPU training cost by 40% by moving to mixed precision and spot instances",
          ] },
        },
        {
          id: "r2", employer: "Boston University Vision Lab", start: "Sep 2020", end: "Jul 2022", location: "Boston, MA",
          main: { title: "Graduate Research Assistant", angle: "Research", facts: [
            "Trained segmentation models (U-Net) on 8,000 annotated microscopy images and reached a Dice score of 0.91",
            "Wrote the data loading and augmentation library the lab still uses, in Python and PyTorch",
            "Co-authored a paper on label-efficient segmentation at a MICCAI workshop",
          ] },
        },
      ],
      {
        skills: [["Machine learning", ["PyTorch", "scikit-learn", "Computer vision", "Segmentation", "Time series forecasting"]], ["Engineering", ["Python", "SQL", "Airflow", "MLflow", "Docker", "AWS SageMaker", "FastAPI"]]],
        projects: [{ name: "skinlesion-bench", description: "An open benchmark of skin lesion classifiers", url: "https://github.com/dokafor/skinlesion-bench", technologies: ["PyTorch", "Python"], text: "Benchmarked 6 skin lesion classifiers on ISIC 2019 with a shared training harness; 300 GitHub stars." }],
        education: [
          { institution: "Boston University", degree: "Master of Science", field: "Computer Science", start: "2020", end: "2022" },
          { institution: "University of Lagos", degree: "Bachelor of Science", field: "Electrical Engineering", start: "2014", end: "2018" },
        ],
      },
    ),
    job: {
      title: "Machine Learning Engineer", company: "Clarity Imaging", location: "Boston, MA (hybrid)",
      aboutCompany: "Clarity Imaging builds AI that helps radiologists read scans faster and catch what is easy to miss.",
      responsibilities: ["Train and evaluate deep learning models on CT and MRI data", "Build the pipelines that take models from research to production", "Work with radiologists to define labels and evaluation", "Monitor models in production for drift"],
      requirements: {
        required: ["3+ years building machine learning models in production", "Strong Python and PyTorch", "Experience with computer vision, ideally segmentation or detection", "Experience with MLOps: training pipelines, experiment tracking, model serving"],
        preferred: ["Experience with medical imaging data (DICOM)", "Familiarity with HIPAA and working with protected health information", "Publications in computer vision or medical imaging"],
      },
      technologies: ["PyTorch", "Python", "Kubernetes", "AWS", "DICOM", "MLflow"],
      keywords: ["Deep learning", "Medical imaging", "Radiology", "Model monitoring", "Healthcare", "Rigor"],
      companyProfile: null,
    },
  },
  {
    id: "designer-marketplace",
    about: "Product designer from an agency and in-house writing for a senior role at a marketplace; hybrid office condition ticked to mention",
    contact: contact("Mei Lin", "mei@example.com", "Brooklyn, NY", ["https://meilin.design"]),
    ticks: [{ match: /office|hybrid/i }],
    record: record(
      [
        {
          id: "r1", employer: "Thrift & Co", start: "May 2022", end: "", location: "New York, NY",
          main: { title: "Product Designer", angle: "Design", facts: [
            "Redesigned the seller listing flow; listings completed per session rose from 41% to 63%",
            "Started the company's design system in Figma with 120 components, now used by 3 product squads",
            "Ran weekly usability tests with buyers and sellers and shared the clips in a Monday readout",
            "Designed checkout changes tested in 9 A/B experiments with the growth team; 4 shipped and lifted conversion by 6%",
            "Worked with 2 engineers to make the buyer app meet WCAG 2.1 AA",
          ] },
        },
        {
          id: "r2", employer: "Brightside Studio", start: "Jun 2019", end: "Apr 2022", location: "New York, NY",
          main: { title: "UX Designer", angle: "Design", facts: [
            "Designed web and mobile apps for 11 clients in retail, travel and healthcare",
            "Led discovery workshops with client stakeholders and turned them into journey maps and wireframes",
            "Built interactive prototypes in Figma and ProtoPie for usability testing and investor demos",
          ] },
        },
      ],
      {
        skills: [["Design", ["Interaction design", "Design systems", "Prototyping", "Usability testing", "Accessibility (WCAG)"]], ["Tools", ["Figma", "ProtoPie", "Maze", "Amplitude"]]],
        education: [{ institution: "Parsons School of Design", degree: "Bachelor of Fine Arts", field: "Communication Design", start: "2015", end: "2019" }],
        achievements: ["Featured in Figma's community spotlight for the Thrift & Co design system (2024)"],
      },
    ),
    job: {
      title: "Senior Product Designer", company: "Stallmarket", location: "New York, NY",
      aboutCompany: "Stallmarket is the marketplace for independent makers to sell handmade goods.",
      responsibilities: ["Lead design for the seller experience, from onboarding to payouts", "Contribute to and grow our design system", "Plan and run research with sellers", "Partner with product and engineering from discovery to launch"],
      requirements: {
        required: ["5+ years of product design experience", "A portfolio showing end-to-end product work", "Experience with design systems", "Experience designing for two-sided marketplaces", "Hybrid: in our New York office 3 days a week"],
        preferred: ["Experience running A/B tests with a growth team", "Mobile app design experience"],
      },
      technologies: ["Figma", "Amplitude"],
      keywords: ["Marketplace", "Seller experience", "Design systems", "User research", "Accessibility", "Craft", "Collaboration"],
      companyProfile: null,
    },
  },
  {
    id: "teacher-to-instructional-design",
    about: "Science teacher with a curriculum telling of the same role, switching into instructional design at an edtech company; tool gaps assumed",
    contact: contact("Jordan Ellis", "jordan@example.com", "Denver, CO"),
    ticks: [],
    record: record(
      [
        {
          id: "r1", employer: "Lincoln High School", start: "Aug 2017", end: "", location: "Denver, CO",
          main: { title: "Science Teacher", angle: "Teaching", facts: [
            "Teach chemistry and biology to 150 students a year across 5 sections",
            "Raised the share of students passing the state chemistry exam from 68% to 84% over three years",
            "Moved all course materials to Google Classroom during remote learning in 2020",
            "Coach the science olympiad team, which reached state finals twice",
          ] },
          alt: { title: "Science Curriculum Lead", angle: "Curriculum", facts: [
            "Led a team of 6 teachers in rewriting the 9th grade science curriculum around the NGSS standards",
            "Designed 40 lab-based units with rubrics and assessments, now used across 4 district schools",
            "Ran 8 professional development sessions for 60 teachers on project-based learning",
            "Built self-paced review modules in Google Forms that students used before exams, with 900 completions a term",
          ] },
        },
      ],
      {
        skills: [["Teaching", ["Curriculum design", "Assessment design", "Project-based learning", "NGSS"]], ["Tools", ["Google Classroom", "Google Forms", "Canva", "Screencastify"]]],
        education: [
          { institution: "University of Colorado Denver", degree: "Master of Arts", field: "Curriculum and Instruction", start: "2019", end: "2021" },
          { institution: "Colorado State University", degree: "Bachelor of Science", field: "Biology", start: "2012", end: "2016" },
        ],
        certifications: [{ name: "Colorado Professional Teaching License, Science 7-12", issuer: "Colorado Department of Education" }],
      },
    ),
    job: {
      title: "Instructional Designer", company: "Learnwell", location: "Remote",
      aboutCompany: "Learnwell makes online courses that companies use to train their frontline staff.",
      responsibilities: ["Design and build e-learning modules with subject matter experts", "Write learning objectives, storyboards and assessments", "Build courses in Articulate Storyline and Rise and publish them to client LMSs", "Measure learner outcomes and improve courses"],
      requirements: {
        required: ["3+ years designing learning experiences", "Experience with ADDIE or a similar instructional design model", "Experience with Articulate Storyline or Rise", "Strong writing and storyboarding skills"],
        preferred: ["Experience with SCORM and learning management systems", "Experience working with subject matter experts", "Video editing skills"],
      },
      technologies: ["Articulate Storyline", "Articulate Rise", "SCORM", "LMS"],
      keywords: ["E-learning", "Instructional design", "Adult learning", "Corporate training", "Storyboarding", "Learner empathy"],
      companyProfile: null,
    },
  },
];
