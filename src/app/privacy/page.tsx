import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { Fill, Note, type LegalSection } from "@/components/legal/LegalPage";
import "../legal/legal.css";

export const metadata: Metadata = {
  title: "Privacy Policy — QRouter",
  description:
    "What personal data QRouter collects, why we process it, the subprocessors that receive it, how long we keep it, how to delete it, and how to exercise your privacy rights.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy Policy — QRouter",
    description: "How QRouter collects, uses, shares, and retains personal data.",
    type: "article",
  },
};

const LAST_UPDATED = "6 August 2026";

/* TODO(legal): every <Fill /> below marks a business or legal fact that cannot
   be derived from the codebase. Replace all of them — and delete this comment —
   before this policy is published or linked from a signup flow. */

const SECTIONS: LegalSection[] = [
  {
    id: "who-we-are",
    title: "Who we are and what this policy covers",
    body: (
      <>
        <Note>
          We are the controller for the personal data described here. This policy covers the QRouter
          website, console, and API.
        </Note>
        <p>
          This Privacy Policy explains how <Fill name="LEGAL_ENTITY_NAME" />,{" "}
          <Fill name="ENTITY_TYPE_AND_JURISDICTION" />, of <Fill name="COMPANY_ADDRESS" /> (
          <strong>we</strong>, <strong>us</strong>, <strong>QRouter</strong>) collects, uses, shares,
          and protects personal data when you use the QRouter website, the console, the HTTP API, and
          related services (the <strong>Service</strong>).
        </p>
        <p>
          For the personal data described in this policy we act as the{" "}
          <strong>data controller</strong> under the EU and UK General Data Protection Regulation. Our
          use of the Service is governed separately by the{" "}
          <Link href="/terms">Terms of Service</Link>.
        </p>
        <ul>
          <li>
            Privacy contact: <Fill name="PRIVACY_EMAIL" />
          </li>
          <li>
            Data protection contact: <Fill name="DPO_CONTACT" />
          </li>
          <li>
            EU / UK representative (Article 27 GDPR, where applicable):{" "}
            <Fill name="EU_UK_REPRESENTATIVE" />
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "summary",
    title: "The short version",
    body: (
      <>
        <ul>
          <li>
            You sign in with Google or GitHub. We never see or store a password.
          </li>
          <li>
            We collect the account, workspace, billing, and usage data needed to run circuits and
            charge for them accurately.
          </li>
          <li>
            <strong>
              Circuits you submit are transmitted to the quantum compute provider that runs them.
            </strong>{" "}
            That is inherent to the product — see{" "}
            <a href="#provider-transmission">how circuits reach compute providers</a>.
          </li>
          <li>
            Card details go to Stripe, not to us. We store only Stripe&apos;s customer identifier and
            our own credit ledger.
          </li>
          <li>
            We set only the cookies needed to keep you signed in. There is no analytics, advertising,
            or cross-site tracking, so there is no cookie banner.
          </li>
          <li>
            We do not sell personal data, and we do not share it for cross-context behavioural
            advertising.
          </li>
          <li>
            You can purge circuit source, results, and stored artifacts yourself through the API, and
            you can ask us to erase your account data.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "what-we-collect",
    title: "Personal data we collect",
    body: (
      <>
        <p>
          Most of this comes directly from you or is generated as you use the Service. We do not buy
          personal data from data brokers and we do not enrich your profile from third-party sources.
        </p>
        <div className="legal-table-scroll">
          <table className="legal-table">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">What it includes</th>
                <th scope="col">Where it comes from</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Account and profile</td>
                <td>
                  Email address, display name, and the account identifier from your sign-in provider;
                  optional company or project name; your interface preferences; whether onboarding and
                  billing setup are complete.
                </td>
                <td>Google or GitHub at sign-in; the onboarding form</td>
              </tr>
              <tr>
                <td>Workspace and membership</td>
                <td>
                  Workspace name and identifier, who created it, and each member&apos;s role (owner,
                  admin, developer, billing, or member).
                </td>
                <td>Created automatically at signup; workspace administrators</td>
              </tr>
              <tr>
                <td>Waitlist application</td>
                <td>
                  Name, email address, LinkedIn profile URL, job title, self-declared quantum
                  experience level, how you heard about us, and the status of your application.
                </td>
                <td>The waitlist form</td>
              </tr>
              <tr>
                <td>Contact enquiries</td>
                <td>Name, email address, phone number, and the content of your message.</td>
                <td>The public contact form</td>
              </tr>
              <tr>
                <td>Support reports</td>
                <td>
                  Your account identifier and email, the category, subject, and body of the report, its
                  status, and our internal notes on it.
                </td>
                <td>The in-console report form</td>
              </tr>
              <tr>
                <td>Billing</td>
                <td>
                  The customer identifier issued by our payment processor, whether a payment method is
                  saved, your credit balance, and a ledger of every purchase, reservation, charge,
                  release, refund, and adjustment with the associated payment identifier.{" "}
                  <strong>We never receive or store your full card number.</strong>
                </td>
                <td>Generated as you buy and consume credits; Stripe</td>
              </tr>
              <tr>
                <td>API credentials</td>
                <td>
                  For each API key: its label, a short non-secret prefix, environment, scopes, creation
                  and last-used timestamps, and expiry or revocation time. The key itself is stored
                  only as an irreversible SHA-256 hash.
                </td>
                <td>Created by workspace administrators</td>
              </tr>
              <tr>
                <td>Usage and technical</td>
                <td>
                  Job timestamps and status transitions, routing decisions and rejection reasons,
                  request identifiers, per-key request counters used for rate limiting, and the server
                  and platform logs our hosting and database providers generate, which include IP
                  address and user agent.
                </td>
                <td>Generated automatically as you use the Service</td>
              </tr>
              <tr>
                <td>Integrations</td>
                <td>
                  If you connect GitHub: the app installation identifier and the connected account
                  login and type. For each project: repository name and URL, branches, and the circuit
                  path. If you configure webhooks: the destination URL and delivery history.
                </td>
                <td>You, when you enable the integration</td>
              </tr>
              <tr>
                <td>Assistant conversations</td>
                <td>
                  The messages you send to the console assistant, the model replies and reasoning
                  summaries, thread titles, and per-workspace message and token counters.
                </td>
                <td>You, when you use the assistant</td>
              </tr>
              <tr>
                <td>Access administration</td>
                <td>
                  Email addresses recorded on the pilot access list and the administrator list, and who
                  added them.
                </td>
                <td>Our administrators</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          We do not intentionally collect special category data (such as health, biometric, or
          political data). Please do not put such data into circuit names, support messages, or the
          console assistant.
        </p>
      </>
    ),
  },
  {
    id: "your-circuits",
    title: "Your circuits, results, and artifacts",
    body: (
      <>
        <p>
          Circuit source, transpiled programs, execution results, job parameters, and connected
          repository content are your content rather than data about you, but they are held under your
          account and are covered by this policy. We treat them as confidential to your workspace.
        </p>
        <p>We store, for each submission:</p>
        <ul>
          <li>the OpenQASM source and a hash of it;</li>
          <li>the analysis, the routing decision and its trace, the quote, and the chosen backend;</li>
          <li>
            encrypted copies of the source, the transpiled program, and the result as stored artifacts;
            and
          </li>
          <li>
            the request and response exchanged with the compute provider, kept as a diagnostic record
            of the attempt.
          </li>
        </ul>
        <p>
          If a circuit contains personal data — for example in a comment, a job name, or embedded
          input data — that data is processed as part of running the job and is transmitted to the
          compute provider along with the circuit. Please avoid putting personal data into circuits.
        </p>
      </>
    ),
  },
  {
    id: "provider-transmission",
    title: "Circuits are transmitted to the compute provider that runs them",
    body: (
      <>
        <Note>
          This is the most important disclosure in this policy. QRouter routes work to hardware
          operated by other companies. Running a circuit means sending it to one of them.
        </Note>
        <p>
          When a job is dispatched, we transmit the transpiled circuit, the shot count, and the
          associated job identifiers to the selected compute provider. The provider executes the
          program on its own infrastructure, under its own terms and privacy practices, and returns a
          result which we normalize and store for you.
        </p>
        <p>
          Which provider receives your circuit depends on the routing decision for that job, on the
          constraints and target you set, and on which backends are available. The console and the API
          show the selected backend before execution when you request a quote, and the job record
          preserves it afterwards. If you need a specific provider — or need to avoid one — pin the
          target rather than relying on automatic routing.
        </p>
        <p>
          Compute providers act as independent controllers of the data they receive, not as our
          processors. We cannot control how long a provider retains a submitted program, whether it is
          reviewed by provider staff, or which jurisdictions it is processed in. Review the terms of
          any provider you route to before submitting sensitive or proprietary circuits.
        </p>
        <p>
          The current provider list is under <a href="#subprocessors">who we share data with</a>.
          Simulator-only routing keeps the workload within
          our own infrastructure and the infrastructure provider that hosts it.
        </p>
      </>
    ),
  },
  {
    id: "why-we-use-it",
    title: "Why we use your data, and our legal bases",
    body: (
      <>
        <p>
          Where the EU or UK GDPR applies, we rely on the following legal bases under Article 6. Where
          it does not apply, the purposes are the same.
        </p>
        <div className="legal-table-scroll">
          <table className="legal-table">
            <thead>
              <tr>
                <th scope="col">Purpose</th>
                <th scope="col">Data used</th>
                <th scope="col">Legal basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Create and secure your account and workspace</td>
                <td>Account, profile, workspace and membership data</td>
                <td>Article 6(1)(b) — performance of a contract</td>
              </tr>
              <tr>
                <td>Analyze, price, route, execute, and return your workloads</td>
                <td>Circuits, job parameters, results, API credentials, usage data</td>
                <td>Article 6(1)(b) — performance of a contract</td>
              </tr>
              <tr>
                <td>Take payment, meter credits, and keep the ledger</td>
                <td>Billing data, ledger entries, payment identifiers</td>
                <td>
                  Article 6(1)(b) — contract; Article 6(1)(c) — legal obligation for accounting and tax
                  records
                </td>
              </tr>
              <tr>
                <td>Review waitlist applications and grant pilot access</td>
                <td>Waitlist application data, access list entries</td>
                <td>
                  Article 6(1)(b) — steps at your request before a contract; Article 6(1)(f) —
                  legitimate interest in selecting suitable pilot participants
                </td>
              </tr>
              <tr>
                <td>Answer your enquiries and provide support</td>
                <td>Contact form data, support reports, account data</td>
                <td>Article 6(1)(b) — contract; Article 6(1)(f) — responding to your enquiry</td>
              </tr>
              <tr>
                <td>Send operational messages about your account, jobs, and billing</td>
                <td>Email address, job and billing events</td>
                <td>Article 6(1)(b) — performance of a contract</td>
              </tr>
              <tr>
                <td>Prevent abuse, enforce quotas and rate limits, and secure the Service</td>
                <td>Usage counters, request identifiers, logs, API key metadata</td>
                <td>Article 6(1)(f) — legitimate interest in a secure, available service</td>
              </tr>
              <tr>
                <td>Debug failures and improve routing, pricing, and reliability</td>
                <td>Job records, provider request and response diagnostics, aggregated metrics</td>
                <td>Article 6(1)(f) — legitimate interest in maintaining and improving the Service</td>
              </tr>
              <tr>
                <td>Comply with law, including export control and sanctions screening</td>
                <td>Account and workspace data, usage records</td>
                <td>Article 6(1)(c) — legal obligation; Article 6(1)(f) — legitimate interest</td>
              </tr>
              <tr>
                <td>Establish, exercise, or defend legal claims</td>
                <td>Whatever is relevant to the claim</td>
                <td>Article 6(1)(f) — legitimate interest</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          We do not currently run a marketing mailing list. If we start sending marketing email, we
          will rely on your consent under Article 6(1)(a) where required and every message will have a
          one-click unsubscribe. You can object to any processing based on legitimate interests — see
          <a href="#your-rights">your rights</a>.
        </p>
      </>
    ),
  },
  {
    id: "subprocessors",
    title: "Who we share data with",
    body: (
      <>
        <p>
          We do not sell personal data. We share it with the service providers below, who process it on
          our behalf or, in the case of compute providers and identity providers, as independent
          controllers for the part they operate. Which of them is engaged depends on how your job is
          routed and which integrations you enable.
        </p>
        <div className="legal-table-scroll">
          <table className="legal-table">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Role</th>
                <th scope="col">What it receives</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Supabase</td>
                <td>Database, authentication, and file storage</td>
                <td>
                  Substantially all account, workspace, job, billing-ledger, assistant, waitlist, and
                  support data, plus encrypted artifacts when object storage is not configured
                </td>
              </tr>
              <tr>
                <td>Vercel</td>
                <td>Application hosting and content delivery</td>
                <td>
                  Request metadata and server logs, including IP address and user agent, and any data
                  in transit through the application
                </td>
              </tr>
              <tr>
                <td>Stripe</td>
                <td>Payment processing</td>
                <td>
                  Your card details entered into Stripe&apos;s payment form, the customer record
                  associated with your workspace, and purchase amounts and identifiers
                </td>
              </tr>
              <tr>
                <td>Google</td>
                <td>
                  Google sign-in, and the Gemini API behind the console assistant
                </td>
                <td>
                  For sign-in: your email and basic profile. For the assistant: the text of your
                  requests and the workspace context attached to them
                </td>
              </tr>
              <tr>
                <td>GitHub</td>
                <td>GitHub sign-in and repository access through our GitHub App</td>
                <td>
                  For sign-in: your email and basic profile. For repositories: the installation and
                  repository selections you grant, in order to read the files you point us at
                </td>
              </tr>
              <tr>
                <td>Amazon Web Services</td>
                <td>
                  Amazon Braket execution — including the IonQ, IQM, and Rigetti processors offered
                  through it — and result storage
                </td>
                <td>Transpiled circuits, shot counts, job identifiers, and execution results</td>
              </tr>
              <tr>
                <td>IBM Quantum</td>
                <td>Execution on IBM quantum hardware</td>
                <td>Transpiled circuits, shot counts, job identifiers, and execution results</td>
              </tr>
              <tr>
                <td>IonQ</td>
                <td>Execution on IonQ hardware when addressed directly</td>
                <td>Transpiled circuits, shot counts, job identifiers, and execution results</td>
              </tr>
              <tr>
                <td>Vultr</td>
                <td>
                  Simulator capacity, encrypted artifact object storage, and AI inference for the
                  routing advisor
                </td>
                <td>
                  Circuits and shot counts sent for simulation, encrypted artifact objects, and
                  advisor request text where that provider is used
                </td>
              </tr>
              <tr>
                <td>OpenRouter</td>
                <td>Fallback AI inference for the routing advisor</td>
                <td>Advisor request text, where the primary inference provider is unavailable</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          We also share personal data with professional advisers where necessary, with authorities
          where we are legally required to, and with an acquirer if we are involved in a merger,
          acquisition, or sale of assets — in which case we will tell you before your data becomes
          subject to a different policy.
        </p>
        <p>
          If you configure a webhook endpoint, job events including execution results are delivered to
          the URL you supply. Data sent there leaves our control and is your responsibility.
        </p>
        <p>
          Where a provider acts as our processor, we put a data processing agreement in place. The
          status of those agreements and of the{" "}
          <a href="#transfers">international transfer safeguards</a> is:{" "}
          <Fill name="DPA_AND_TRANSFER_STATUS" />.
        </p>
      </>
    ),
  },
  {
    id: "transfers",
    title: "International transfers",
    body: (
      <>
        <p>
          The providers listed under <a href="#subprocessors">who we share data with</a> operate
          globally, and several are established in the United
          States. Using the Service therefore involves transferring personal data outside the European
          Economic Area and the United Kingdom. Individual quantum backends are located in specific
          regions — for example the Braket devices we route to sit in United States and European
          regions — so a job may be executed in a country different from the one you are in.
        </p>
        <p>
          Our primary data hosting regions are: <Fill name="DATA_HOSTING_REGIONS" />.
        </p>
        <p>
          Where we transfer personal data out of the EEA or the UK, we rely on an adequacy decision
          where one covers the recipient, and otherwise on the European Commission&apos;s Standard
          Contractual Clauses together with the UK International Data Transfer Addendum, supported by
          the technical measures under <a href="#security">how we protect your data</a>. You can ask us
          for details of the safeguards applying
          to a specific transfer by writing to <Fill name="PRIVACY_EMAIL" />.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep data, and how to delete it",
    body: (
      <>
        <Note>
          You can purge circuit source, results, and stored artifacts yourself through the API. Account
          closure is currently handled by request.
        </Note>
        <p>
          We keep personal data only as long as we need it for the purposes set out under{" "}
          <a href="#why-we-use-it">why we use your data</a>.
        </p>
        <div className="legal-table-scroll">
          <table className="legal-table">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Retention</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Account, profile, workspace, and membership</td>
                <td>For as long as the account exists, then erased on closure</td>
              </tr>
              <tr>
                <td>Circuit source, transpiled programs, results, and artifacts</td>
                <td>
                  Until you release or delete the circuit, or the account is closed. Otherwise:{" "}
                  <Fill name="RETENTION_PERIOD" />
                </td>
              </tr>
              <tr>
                <td>Job records, routing decisions, events, and provider diagnostics</td>
                <td>
                  Job and routing history remain as the execution and billing audit trail after a
                  release. Provider attempt rows and event payloads for that circuit&apos;s jobs are
                  cleared with the release: <Fill name="RETENTION_PERIOD" />
                </td>
              </tr>
              <tr>
                <td>Webhook delivery records and payloads</td>
                <td>
                  Delivery history may remain; payloads for jobs of a released or deleted circuit are
                  cleared with that operation. Otherwise: <Fill name="RETENTION_PERIOD" />
                </td>
              </tr>
              <tr>
                <td>Billing ledger and payment records</td>
                <td>
                  For the period required by applicable tax and accounting law, typically six to ten
                  years from the transaction
                </td>
              </tr>
              <tr>
                <td>Assistant conversation threads</td>
                <td>
                  Until the thread or the workspace is deleted: <Fill name="RETENTION_PERIOD" />
                </td>
              </tr>
              <tr>
                <td>Assistant usage counters</td>
                <td>Automatically deleted two days after the usage window</td>
              </tr>
              <tr>
                <td>API rate-limit counters</td>
                <td>Automatically deleted ten minutes after the window closes</td>
              </tr>
              <tr>
                <td>Waitlist applications</td>
                <td>
                  Until the application is decided, then: <Fill name="RETENTION_PERIOD" />
                </td>
              </tr>
              <tr>
                <td>Contact enquiries and support reports</td>
                <td>
                  <Fill name="RETENTION_PERIOD" />
                </td>
              </tr>
              <tr>
                <td>Server and platform logs</td>
                <td>
                  For the retention period of the hosting and database providers listed under{" "}
                  <a href="#subprocessors">who we share data with</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <h3>Deleting data yourself</h3>
        <ul>
          <li>
            <strong>Release a circuit</strong> — <code>POST /api/v2/circuits/&#123;id&#125;/release</code>{" "}
            erases the stored source, results, provider attempt diagnostics, job-event and webhook-delivery
            payloads, and encrypted artifacts for that circuit and its executions, once every job has
            reached a final state. Job, quote, and billing records remain as the audit trail.
          </li>
          <li>
            <strong>Delete a circuit</strong> — <code>DELETE /api/v2/circuits/&#123;id&#125;</code> does
            the same scrub and then removes the circuit record.
          </li>
          <li>
            <strong>Revoke an API key</strong> or <strong>remove a webhook endpoint</strong> from the
            console at any time.
          </li>
          <li>
            <strong>Disconnect billing</strong> from the console to remove saved payment methods, or
            uninstall the GitHub App to end repository access.
          </li>
        </ul>
        <p>
          Releasing or deleting a circuit through the API clears circuit content in the database and
          removes the related encrypted artifact objects. Age-based SQL retention uses the same database
          scrub; encrypted objects in object storage are removed on the API release and delete paths, so
          do not treat a SQL-only scheduled purge as a complete artifact wipe.
        </p>
        <h3>Closing your account</h3>
        <p>
          There is no self-service account deletion in the console today. To close your account and
          have the associated personal data erased, email <Fill name="PRIVACY_EMAIL" /> from the
          address on the account. We will confirm your identity, erase or anonymize your personal data,
          and retain only what we are legally required to keep — principally billing and tax records —
          for the period stated above.
        </p>
        <p>
          Deleted data may persist in encrypted backups for a limited period before those backups
          expire on their normal cycle.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "How we protect your data",
    body: (
      <>
        <p>
          These are the measures actually implemented in the Service today. They are a description of
          our controls, not a warranty of absolute security.
        </p>
        <ul>
          <li>
            <strong>No passwords.</strong> Sign-in is delegated to Google or GitHub, so we never handle
            or store a password.
          </li>
          <li>
            <strong>API keys are stored as hashes.</strong> Only an irreversible SHA-256 hash and a
            short non-secret prefix are kept. The key itself is shown once and cannot be recovered from
            our systems.
          </li>
          <li>
            <strong>Sensitive values are encrypted at rest.</strong> Circuit source, transpiled
            programs, and results written to object storage are encrypted with AES-256-GCM before
            upload, as are provider credentials and webhook signing secrets.
          </li>
          <li>
            <strong>Tenant isolation is enforced in the database.</strong> Row-level security is
            enabled on the tables holding customer data, and access is checked against workspace
            membership on every query. Artifact storage is private and scoped to the owning workspace.
          </li>
          <li>
            <strong>Privileged operations are server-only.</strong> The database routines that move
            credits and dispatch jobs cannot be called by a browser or an API client; access to
            infrastructure credentials is restricted to server-side code.
          </li>
          <li>
            <strong>Encryption in transit.</strong> All traffic to the Service and to the providers
            listed under <a href="#subprocessors">who we share data with</a> uses TLS.
          </li>
          <li>
            <strong>Abuse controls.</strong> API requests are rate limited per key, the console
            assistant is quota limited per workspace, and console access is restricted to an approval
            list during the pilot.
          </li>
          <li>
            <strong>Restricted administration.</strong> Administrative views are limited to a named
            list of administrator accounts held in the database.
          </li>
        </ul>
        <p>
          No system is completely secure. If you believe your account or a key has been compromised,
          revoke the key and contact <Fill name="SECURITY_EMAIL" /> immediately.
        </p>
      </>
    ),
  },
  {
    id: "your-rights",
    title: "Your rights",
    body: (
      <>
        <p>
          If you are in the European Economic Area, the United Kingdom, or another region with
          comparable law, you have the rights below. We honour these requests for everyone, wherever
          you are, unless the law prevents it.
        </p>
        <ul>
          <li>
            <strong>Access</strong> — get confirmation of whether we process your personal data and a
            copy of it.
          </li>
          <li>
            <strong>Rectification</strong> — have inaccurate data corrected and incomplete data
            completed.
          </li>
          <li>
            <strong>Erasure</strong> — have your personal data deleted where we no longer have grounds
            to keep it.
          </li>
          <li>
            <strong>Restriction</strong> — have us pause processing while a dispute about accuracy or
            legitimacy is resolved.
          </li>
          <li>
            <strong>Portability</strong> — receive the data you gave us in a structured,
            machine-readable format, or have it sent to another controller where technically feasible.
          </li>
          <li>
            <strong>Objection</strong> — object to processing based on our legitimate interests, on
            grounds relating to your situation.
          </li>
          <li>
            <strong>Withdraw consent</strong> — where we rely on consent, withdraw it at any time,
            without affecting processing already carried out.
          </li>
          <li>
            <strong>Complain</strong> — lodge a complaint with your local supervisory authority. We
            would appreciate the chance to address it first.
          </li>
        </ul>
        <p>
          To exercise any of these, email <Fill name="PRIVACY_EMAIL" /> from the address on your
          account, or use the <Link href="/contact">contact form</Link>. We may ask for information to
          confirm your identity. We respond within one month, and will tell you if we need up to two
          further months because the request is complex. Exercising these rights is free unless a
          request is manifestly unfounded or excessive.
        </p>
      </>
    ),
  },
  {
    id: "us-privacy",
    title: "United States privacy rights",
    body: (
      <>
        <p>
          This section applies to residents of California and of other US states with comprehensive
          privacy laws.
        </p>
        <p>
          In the past twelve months we have collected the following categories of personal information
          under the California Consumer Privacy Act as amended by the CPRA: identifiers (name, email,
          account identifier, IP address); commercial information (credit purchases and consumption);
          internet or network activity (API and console usage, logs); professional or
          employment-related information (job title and experience level, if you applied to the
          waitlist); and inferences drawn only for routing and reliability purposes. The sources,
          purposes, and recipients are described under{" "}
          <a href="#what-we-collect">personal data we collect</a>,{" "}
          <a href="#why-we-use-it">why we use your data</a>, and{" "}
          <a href="#subprocessors">who we share data with</a>.
        </p>
        <p>
          <strong>
            We do not sell personal information, and we do not share personal information for
            cross-context behavioural advertising.
          </strong>{" "}
          We have not done so in the preceding twelve months, including for consumers we know to be
          under 16. We do not use or disclose sensitive personal information for purposes beyond those
          permitted without an opt-out, so no &quot;Limit the Use of My Sensitive Personal
          Information&quot; link is required.
        </p>
        <p>
          You have the right to know what we collect and why, to request deletion, to request
          correction, to opt out of sale or sharing (which does not occur), and not to be discriminated
          against for exercising these rights. Submit a request to <Fill name="PRIVACY_EMAIL" />. An
          authorized agent may submit on your behalf with proof of authorization; we will still verify
          your identity directly.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and local storage",
    body: (
      <>
        <Note>
          We set only the cookies needed to keep you signed in. There is no analytics, advertising, or
          cross-site tracking on this site, and therefore no cookie banner.
        </Note>
        <p>
          <strong>Authentication cookies (strictly necessary).</strong> When you sign in, our
          authentication provider sets session cookies that identify your session and hold the tokens
          that keep you signed in. Our server refreshes them as you browse. Without them you cannot use
          the console. They are removed when you sign out or when the session expires.
        </p>
        <p>
          <strong>Theme preference (local storage, not a cookie).</strong> Your light or dark
          appearance choice is saved in your browser under <code>qrouter-theme</code>. It stays on your
          device and is never sent to our servers.
        </p>
        <p>
          <strong>Payment fraud prevention (third party).</strong> When the Stripe payment form is
          displayed during billing setup, Stripe sets its own cookies to detect fraudulent activity.
          These are set by Stripe under its own privacy policy and are necessary for the payment
          function you requested.
        </p>
        <p>
          <strong>What we do not use.</strong> No analytics, product-analytics, session-recording,
          advertising, retargeting, or social media tracking technologies are loaded on this site. No
          third-party tracking pixels are embedded.
        </p>
        <p>
          You can block or delete cookies through your browser settings, but blocking the
          authentication cookies will prevent you from signing in. If we ever introduce non-essential
          cookies, we will ask for your consent first and update this section.
        </p>
      </>
    ),
  },
  {
    id: "automated-decisions",
    title: "Automated processing and AI",
    body: (
      <>
        <p>
          <strong>Routing.</strong> The QCI Engine automatically selects a backend for your workload by
          applying your constraints and scoring eligible candidates on projected quality, queue time,
          cost, and reliability. This decision is based on the properties of the circuit and the
          parameters you set, not on personal data about you, and it does not produce legal or
          similarly significant effects on you within the meaning of Article 22 GDPR. Every decision
          keeps a trace you can inspect, and you can override it by pinning a target.
        </p>
        <p>
          <strong>Assistant and routing advisor.</strong> These features send the text you enter, plus
          the workspace context attached to the request, to a third-party language model provider —
          Google, and where configured Vultr or OpenRouter — which processes it and returns a response.
          Conversations are stored so threads persist, and usage is metered per workspace.
        </p>
        <p>
          We do not use your conversations or your circuits to train our own models. Whether a given
          model provider retains submitted input or uses it to improve its own models depends on the
          plan and terms in effect between us and that provider; our current position is:{" "}
          <Fill name="AI_PROVIDER_TRAINING_TERMS" />.
        </p>
        <p>
          Please do not enter credentials, personal data about other people, or content you are not
          permitted to disclose into the assistant.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children’s privacy",
    body: (
      <p>
        The Service is a developer and research tool intended for people aged 18 and over. It is not
        directed at children, and we do not knowingly collect personal data from anyone under 18. If
        you believe a child has provided us with personal data, contact{" "}
        <Fill name="PRIVACY_EMAIL" /> and we will delete it.
      </p>
    ),
  },
  {
    id: "breach",
    title: "If something goes wrong",
    body: (
      <p>
        We maintain procedures for handling suspected personal data breaches. Where a breach is likely
        to result in a risk to your rights and freedoms, we will notify the competent supervisory
        authority without undue delay and, where feasible, within 72 hours of becoming aware of it.
        Where a breach is likely to result in a high risk to you, we will notify you directly without
        undue delay, describing what happened, the likely consequences, and the steps we are taking.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        We update this policy as the Service changes or as the law requires. The current version is
        always at this page, with the last-updated date at the top. For changes that materially affect
        how we use your personal data, we will give notice by email to the address on your account, by
        an in-console notice, or both, before the change takes effect. Please review it periodically.
      </p>
    ),
  },
  {
    id: "contact",
    title: "How to contact us",
    body: (
      <>
        <p>
          <Fill name="LEGAL_ENTITY_NAME" />, <Fill name="COMPANY_ADDRESS" />.
        </p>
        <ul>
          <li>
            Privacy requests and questions about this policy: <Fill name="PRIVACY_EMAIL" />
          </li>
          <li>
            Data protection contact: <Fill name="DPO_CONTACT" />
          </li>
          <li>
            EU / UK representative: <Fill name="EU_UK_REPRESENTATIVE" />
          </li>
          <li>
            Security reports: <Fill name="SECURITY_EMAIL" />
          </li>
          <li>
            General support: <Fill name="SUPPORT_EMAIL" /> or the{" "}
            <Link href="/contact">contact form</Link>
          </li>
        </ul>
        <p>
          If you are in the EEA or the UK and you are not satisfied with our response, you may complain
          to your national data protection authority.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      lede={
        <>
          What we collect, why we collect it, who receives it, and what you can do about it. The
          section that matters most for this product is{" "}
          <a href="#provider-transmission">how circuits reach compute providers</a>: circuits you
          submit are transmitted to the quantum compute provider that runs them.
        </>
      }
      meta={[
        { term: "Last updated", detail: LAST_UPDATED },
        /* TODO(legal): set the date this policy comes into force. */
        { term: "Effective", detail: <Fill name="EFFECTIVE_DATE" /> },
        { term: "Controller", detail: <Fill name="LEGAL_ENTITY_NAME" /> },
        { term: "Related", detail: <Link href="/terms">Terms of Service</Link> },
      ]}
      sections={SECTIONS}
    />
  );
}
