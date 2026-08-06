import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { Fill, Note, type LegalSection } from "@/components/legal/LegalPage";
import "../legal/legal.css";

export const metadata: Metadata = {
  title: "Terms of Service — QRouter",
  description:
    "The terms that govern use of QRouter: pilot access, workspaces and API keys, acceptable use, prepaid credits and quotes, third-party quantum compute providers, and liability.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/terms" },
  openGraph: {
    title: "Terms of Service — QRouter",
    description: "The terms that govern use of the QRouter quantum execution platform.",
    type: "article",
  },
};

const LAST_UPDATED = "6 August 2026";

/* TODO(legal): every <Fill /> below marks a business or legal fact that cannot
   be derived from the codebase. Replace all of them — and delete this comment —
   before these Terms are published or referenced in a signup flow. */

const SECTIONS: LegalSection[] = [
  {
    id: "agreement",
    title: "Agreement to these Terms",
    body: (
      <>
        <Note>
          These Terms are the contract between you and the company that operates QRouter. Using the
          platform means you accept them.
        </Note>
        <p>
          These Terms of Service (the <strong>Terms</strong>) govern your access to and use of the
          QRouter platform, including the web console, the HTTP API at every published version, the
          command-line and language SDKs, the documentation, and the Quantum Compute Index data we
          publish (together, the <strong>Service</strong>). The Service is operated by{" "}
          <Fill name="LEGAL_ENTITY_NAME" />, <Fill name="ENTITY_TYPE_AND_JURISDICTION" />, registered
          at <Fill name="COMPANY_ADDRESS" /> under registration number{" "}
          <Fill name="COMPANY_REGISTRATION_NUMBER" /> (<strong>we</strong>, <strong>us</strong>,{" "}
          <strong>QRouter</strong>).
        </p>
        <p>
          By creating an account, joining the waitlist, submitting a circuit, calling the API, or
          otherwise using the Service, you agree to these Terms. If you are accepting on behalf of a
          company, university, research group, or other organization, you confirm that you have
          authority to bind that organization, and <strong>you</strong> in these Terms means both you
          personally and that organization.
        </p>
        <p>
          If you do not agree to these Terms, do not use the Service. Our handling of personal data is
          described separately in the <Link href="/privacy">Privacy Policy</Link>, which forms part of
          this agreement.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Eligibility and pilot access",
    body: (
      <>
        <p>
          QRouter is currently operated as a <strong>private pilot</strong>. Console access is granted
          from an approval list maintained by us; joining the waitlist does not create an entitlement
          to access, and we may decline, defer, or withdraw pilot access at our discretion.
        </p>
        <p>To use the Service you must:</p>
        <ul>
          <li>be at least 18 years old, or the age of legal majority where you live if that is higher;</li>
          <li>be able to form a binding contract with us;</li>
          <li>
            not be located in, ordinarily resident in, or organized under the laws of a country or
            territory subject to comprehensive trade sanctions, and not be a person or entity on a
            restricted-party list — see <a href="#export-controls">export controls and sanctions</a>;
            and
          </li>
          <li>
            not have previously had your access to the Service terminated by us for a breach of these
            Terms.
          </li>
        </ul>
        <p>
          The Service is a developer and research tool. It is not intended for consumers, and it is not
          designed, tested, or supported for use in safety-critical, life-support, medical, aviation,
          nuclear, or other high-risk environments where failure could lead to death, personal injury,
          or severe environmental damage.
        </p>
      </>
    ),
  },
  {
    id: "the-service",
    title: "What QRouter does",
    body: (
      <>
        <Note>
          QRouter analyzes your circuit, prices it, and sends it to a quantum backend operated by
          someone else. We are the routing and billing layer, not the hardware.
        </Note>
        <p>
          You submit quantum circuits to QRouter in OpenQASM 2 or OpenQASM 3, either through the
          console or through the HTTP API. For each submission the Service:
        </p>
        <ul>
          <li>parses and analyzes the circuit to derive qubit count, depth, gate set, and other requirements;</li>
          <li>
            filters the backend catalog to targets that can actually run the circuit, and ranks the
            remaining candidates against your routing mode and constraints (balanced, cost, speed, or
            quality) using the QCI Engine;
          </li>
          <li>
            produces a <strong>quote</strong> that breaks out the estimated provider cost, transpiler
            fee, and platform fee, and that expires after a stated time;
          </li>
          <li>transpiles the circuit into a program the selected backend accepts;</li>
          <li>
            reserves credits, submits the program to the selected third-party provider, tracks the
            job through its lifecycle, retries or fails over to another eligible backend where you have
            enabled that, and returns normalized results; and
          </li>
          <li>
            stores the decision trace, the transpiled artifact, and the result so you can retrieve
            them later, and optionally delivers signed webhook events to endpoints you configure.
          </li>
        </ul>
        <p>
          <strong>
            Execution happens on hardware and simulators operated by third parties, not by us.
          </strong>{" "}
          Submitting a circuit to QRouter means the circuit — or a transpiled form of it — is
          transmitted to the compute provider you or the router selects. Section 9 describes what that
          means for you.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Accounts, workspaces, and roles",
    body: (
      <>
        <p>
          You sign in with a Google or GitHub account through our identity provider. We do not issue or
          store passwords. You are responsible for the security of the identity account you use to sign
          in, including its recovery options and second factor.
        </p>
        <p>
          Every account receives a <strong>workspace</strong> (an organization). Jobs, circuits, API
          keys, credits, repositories, and webhook endpoints belong to a workspace rather than to an
          individual. Members of a workspace hold one of the roles <code>owner</code>,{" "}
          <code>admin</code>, <code>developer</code>, <code>billing</code>, or <code>member</code>, and
          those roles determine what each member can read and change.
        </p>
        <p>
          If you add other people to your workspace, you are responsible for their use of the Service,
          for making sure they are permitted to see the data in that workspace, and for removing them
          when they should no longer have access. Anyone with sufficient privileges in a workspace can
          view the circuits, results, and billing history of that workspace.
        </p>
        <p>
          Keep your account information accurate. Tell us promptly at <Fill name="SUPPORT_EMAIL" /> if
          you believe an account, workspace, or API key has been compromised.
        </p>
      </>
    ),
  },
  {
    id: "api-keys",
    title: "API keys and credentials",
    body: (
      <>
        <Note>
          We store only a hash of your API key. We cannot recover it for you, and anything done with it
          counts as done by you.
        </Note>
        <p>
          Workspace administrators can issue API keys in a <code>test</code> or <code>live</code>{" "}
          environment. Test keys may only run on simulators; live keys may reach QPUs as well. Scopes
          attached to a key are enforced for API requests. The full key value is displayed once, at
          creation. We keep a SHA-256 hash and a short non-secret prefix so the key can be identified
          and revoked; we do not retain the key itself and cannot show it to you again.
        </p>
        <p>You agree to:</p>
        <ul>
          <li>keep API keys confidential and out of client-side code, public repositories, and shared logs;</li>
          <li>issue separate keys per application or environment and scope them to what each one needs;</li>
          <li>revoke a key immediately if it may have been exposed; and</li>
          <li>
            treat any provider credentials, webhook signing secrets, and repository tokens connected to
            your workspace with the same care.
          </li>
        </ul>
        <p>
          <strong>
            You are responsible for all activity and all charges incurred under your API keys,
          </strong>{" "}
          including activity by someone who obtains a key from you, unless and until you revoke it.
          Simulator runs under a test key still consume credits. API requests are rate limited per key;
          we may adjust those limits to protect the Service.
        </p>
      </>
    ),
  },
  {
    id: "your-content",
    title: "Your content and the license you grant us",
    body: (
      <>
        <Note>
          Your circuits stay yours. You give us only the permissions we need to analyze, compile, run,
          store, and return them.
        </Note>
        <p>
          <strong>Customer Content</strong> means everything you submit to or generate through the
          Service: circuit source, job names, parameters and constraints, repository files you connect,
          transpiled programs, execution results, webhook payloads, and messages you send to the
          console assistant.
        </p>
        <p>
          As between you and us, you own your Customer Content, and we claim no ownership in it. You
          represent that you have the rights necessary to submit it and that doing so does not infringe
          anyone else&apos;s rights.
        </p>
        <p>
          You grant us a worldwide, non-exclusive, royalty-free license to host, store, copy, transmit,
          reformat, transpile, and display Customer Content{" "}
          <strong>solely for the purposes of</strong>:
        </p>
        <ul>
          <li>operating the Service and performing the workload you asked us to perform;</li>
          <li>transmitting the circuit to the compute provider you or the router selects;</li>
          <li>storing artifacts and results so you can retrieve them;</li>
          <li>preventing fraud and abuse, and enforcing these Terms; and</li>
          <li>
            providing support you request, and complying with law or a valid legal request.
          </li>
        </ul>
        <p>
          This license lasts only as long as we hold the content, and it ends when the content is
          deleted. It does not permit us to sell your circuits, publish them, or use them to build or
          train models for our own benefit. We may generate and retain aggregated, de-identified
          operational statistics — for example execution counts, latency, error rates, and provider
          cost benchmarks that feed the Quantum Compute Index — provided they do not identify you or
          reveal the content of your circuits.
        </p>
        <p>
          You control deletion. Releasing a circuit through the API purges the stored source, results,
          related attempt diagnostics and event/webhook payloads, and encrypted artifacts for its
          executions; deleting a circuit removes the circuit record as well. The{" "}
          <Link href="/privacy#retention">Privacy Policy</Link> explains retention and deletion in
          detail.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <>
        <p>You must not use the Service, or help anyone else use it, to:</p>
        <ul>
          <li>break any applicable law or regulation, or infringe anyone&apos;s intellectual property, privacy, or other rights;</li>
          <li>
            violate the terms, acceptable-use policies, or access conditions of any compute provider
            the Service routes to, or misrepresent your identity, affiliation, or research purpose to
            such a provider;
          </li>
          <li>
            circumvent or attempt to circumvent quotas, rate limits, credit reservations, provider
            allocation rules, or access controls — including by creating multiple accounts or
            workspaces to obtain additional promotional credit;
          </li>
          <li>
            place a load on the Service or on any connected provider that is designed to, or
            foreseeably would, degrade it for others; use the queue as bulk free compute; or run
            automated submission loops without regard to the quotes returned;
          </li>
          <li>
            attempt to break, defeat, or test the security of the Service or its providers without our
            prior written permission, including probing tenant isolation, attempting to read another
            workspace&apos;s data, or interfering with job routing;
          </li>
          <li>
            reverse engineer, decompile, or disassemble the Service, or attempt to extract its source
            code, routing model, or pricing model, except to the extent that restriction is
            unenforceable under applicable law;
          </li>
          <li>
            resell, sublicense, or provide the Service to third parties as a competing routing or
            brokerage service, or use it to benchmark for a competing product without our written
            consent;
          </li>
          <li>
            upload malware, or use the Service to attack, mine, deanonymize, or attempt to break
            cryptography protecting systems or data you are not authorized to access; or
          </li>
          <li>
            submit workloads for weapons development or other purposes restricted under{" "}
            <a href="#export-controls">export controls and sanctions</a>.
          </li>
        </ul>
        <p>
          Responsible security research is welcome. If you find a vulnerability, report it privately to{" "}
          <Fill name="SECURITY_EMAIL" /> and give us a reasonable opportunity to fix it before
          disclosing it. We will not pursue good-faith research that follows that process and does not
          access, modify, or exfiltrate other users&apos; data.
        </p>
      </>
    ),
  },
  {
    id: "export-controls",
    title: "Export controls, sanctions, and restricted use",
    body: (
      <>
        <Note>
          Quantum computing hardware and software are export-controlled in many countries. This section
          is not boilerplate — read it.
        </Note>
        <p>
          Access to quantum computing resources, including remote access to quantum processors and to
          quantum simulation software, is subject to export control and sanctions laws. You agree to
          comply with all applicable export control, re-export, sanctions, and import laws in
          connection with your use of the Service.
        </p>
        <p>You represent and warrant that:</p>
        <ul>
          <li>
            you are not located in, ordinarily resident in, or organized under the laws of a
            comprehensively sanctioned country or territory, and you are not owned or controlled by a
            person who is;
          </li>
          <li>
            you are not listed on, and are not acting on behalf of anyone listed on, any restricted
            party, denied person, or sanctions list maintained by a competent authority; and
          </li>
          <li>
            you will not use the Service, or allow it to be used, in connection with the development,
            design, production, or deployment of nuclear, chemical, or biological weapons, missile
            technology, or other prohibited end uses.
          </li>
        </ul>
        <p>
          Individual compute providers impose their own nationality, institutional, and end-use
          restrictions on access to their hardware. Routing a job to a given backend does not mean you
          are eligible to use that backend under its own rules; that eligibility is your
          responsibility. We may block routing to particular backends, or suspend access entirely,
          where we believe compliance requires it.
        </p>
      </>
    ),
  },
  {
    id: "providers",
    title: "Third-party compute providers and integrations",
    body: (
      <>
        <p>
          The Service routes workloads to quantum backends and simulators operated by third parties,
          which currently include Amazon Braket (and the quantum processors made available through it),
          IBM Quantum, IonQ, and simulator capacity we operate on third-party infrastructure. The
          catalog changes as providers are added, removed, or become unavailable.
        </p>
        <p>
          When a job is routed, the transpiled circuit, the shot count, and the associated job metadata
          are transmitted to that provider and processed under that provider&apos;s own terms and
          privacy practices. We do not control those providers. We are not responsible for their
          availability, queue times, result accuracy, calibration state, pricing changes, retention of
          submitted programs, or their acts or omissions.
        </p>
        <p>
          Optional integrations behave the same way. If you connect a GitHub repository through our
          GitHub App, repository content you select is read into the Service to build and deploy
          circuits; if you configure a webhook endpoint, job events including results are delivered to
          the URL you supply and leave our control at that point. You are responsible for the security
          and suitability of any endpoint or repository you connect, and for revoking those
          connections when they are no longer needed.
        </p>
        <p>
          Your use of a third-party service through QRouter is between you and that third party to the
          extent their terms apply to you.
        </p>
      </>
    ),
  },
  {
    id: "credits",
    title: "Credits, quotes, and charges",
    body: (
      <>
        <Note>
          QRouter is prepaid. You buy credits, we hold the quoted amount while a job runs, and we
          charge the actual cost — never more than the quote.
        </Note>
        <p>
          The Service is billed with <strong>prepaid credits</strong> denominated in US dollars and
          held at workspace level. Credits are a prepayment for compute and platform services. They are
          not money, not a deposit, not a stored-value or gift instrument, and they carry no interest
          and no cash value.
        </p>
        <p>The billing lifecycle is:</p>
        <ol>
          <li>
            <strong>Purchase.</strong> You add credits from the console using a saved payment method,
            in amounts between $5 and $10,000 per transaction. The purchase is recorded in your
            workspace ledger.
          </li>
          <li>
            <strong>Quote.</strong> Before execution we produce a quote showing the estimated provider
            cost, the transpiler fee, and the platform fee. Quotes expire; an expired quote must be
            repriced before the job can run.
          </li>
          <li>
            <strong>Reservation.</strong> When a job is queued, the quoted total is moved from your
            available balance to a reserved balance. If your available balance is lower than the quote,
            the job parks in <code>awaiting_payment</code> until you add credits, and resumes
            automatically once the balance is sufficient and the quote is still valid.
          </li>
          <li>
            <strong>Settlement.</strong> When a job completes, we charge the actual cost and return any
            difference to your available balance. The charge never exceeds the quoted total. If a job
            fails or is cancelled before completion, the full reservation is released back to your
            available balance.
          </li>
        </ol>
        <p>
          Every purchase, reservation, release, charge, refund, and adjustment is written to a ledger
          you can inspect in the console. That ledger is the authoritative record of your balance. If
          you believe an entry is wrong, contact us within 60 days of the entry so we can investigate.
        </p>
        <p>
          Fees, rates, and index-derived pricing inputs can change. Changes apply to quotes issued
          after the change and never retroactively to a quote you have already accepted.
        </p>
      </>
    ),
  },
  {
    id: "payment",
    title: "Payment method, taxes, and card disputes",
    body: (
      <>
        <p>
          Card payments are processed by Stripe. We do not receive or store your full card number; the
          card is held by Stripe against a customer record and we store only the identifier for that
          record. Your use of the payment flow is also subject to Stripe&apos;s terms.
        </p>
        <p>
          By saving a payment method you authorize us to charge it for credit purchases you initiate,
          including purchases made off-session from the console. You must be authorized to use the
          payment method you provide.
        </p>
        <p>
          Prices are exclusive of taxes. You are responsible for all sales, use, VAT, GST, withholding,
          and similar taxes and duties associated with your purchases, other than taxes based on our
          net income. Where we are required to collect a tax, it will be added to the amount charged.
          If you are exempt, provide valid documentation before purchasing.
        </p>
        <p>
          Please contact us before disputing a charge with your bank. Initiating a chargeback for a
          purchase we can evidence may result in immediate suspension of the workspace and forfeiture
          of the associated credit balance while the dispute is resolved.
        </p>
      </>
    ),
  },
  {
    id: "refunds",
    title: "Refunds, expiry, and promotional credit",
    body: (
      <>
        <p>
          <strong>Refunds.</strong> Credits are consumed as compute is delivered, and delivered compute
          is not refundable. Our policy for unused credit balances is:{" "}
          <Fill name="REFUND_POLICY" />. Nothing in this section limits any non-waivable statutory
          refund or cancellation right you may have as a consumer under your local law.
        </p>
        <p>
          <strong>Expiry.</strong> Purchased credits: <Fill name="CREDIT_EXPIRY_TERM" />.
        </p>
        <p>
          <strong>Promotional credit.</strong> New workspaces receive a starting balance of
          promotional credit for evaluation. Promotional credit has no cash value, is not refundable
          or transferable, is limited to one grant per person or organization, and may be withdrawn or
          expired by us at any time. Attempting to obtain additional promotional credit by creating
          extra accounts or workspaces is a breach of <a href="#acceptable-use">acceptable use</a>.
        </p>
        <p>
          <strong>Provider failures.</strong> If a provider fails to execute a job, the reservation is
          released and you are not charged. If a provider returns a degraded or unusable result but
          reports success, contact us at <Fill name="SUPPORT_EMAIL" /> and we will review the job and
          issue a ledger adjustment where we consider it warranted. We are not otherwise liable for the
          scientific quality of a provider&apos;s output.
        </p>
      </>
    ),
  },
  {
    id: "beta",
    title: "Beta, experimental, and preview features",
    body: (
      <>
        <p>
          The Service as a whole is currently a private pilot, and parts of it are explicitly labelled
          as beta, preview, in development, or sample data. Those features are provided for evaluation
          only. They may change incompatibly, behave unpredictably, lose data, or be withdrawn without
          notice, and they are excluded from any commitment we make elsewhere about availability or
          support.
        </p>
        <p>
          The Quantum Compute Index and the pricing views built on it are indicative modelled figures,
          not an audited market benchmark. Values may be estimated, carried forward, normalized across
          different provider billing units, or generated from deterministic sample data when live
          provider snapshots are unavailable — the interface labels which. Do not rely on index values
          as a financial benchmark, for valuation, or for trading decisions.
        </p>
      </>
    ),
  },
  {
    id: "ai-features",
    title: "AI-assisted features",
    body: (
      <>
        <p>
          The console includes an assistant and routing advisor built on third-party large language
          models. When you use them, the text you enter — which may include circuit source, job
          details, and workspace context we attach to the request — is sent to the model provider for
          processing, and the conversation is stored so the thread persists. Assistant usage is metered
          per workspace and subject to quotas.
        </p>
        <p>
          Model output can be wrong, incomplete, or misleading. It is a suggestion, not advice, and it
          is not a substitute for reviewing a circuit or a routing decision yourself. You are
          responsible for anything you run on the basis of an assistant response, including the cost of
          the resulting jobs. Do not paste credentials, personal data about others, or content you are
          not permitted to disclose into the assistant.
        </p>
        <p>
          We do not use your assistant conversations to train our own models. The model providers we
          use, and their terms regarding retention and training on submitted input, are listed in the{" "}
          <Link href="/privacy#subprocessors">Privacy Policy</Link>.
        </p>
      </>
    ),
  },
  {
    id: "availability",
    title: "Service availability and support",
    body: (
      <>
        <p>
          <strong>We do not currently offer a service level agreement.</strong> The Service is provided
          on an as-available basis. We may modify, suspend, or discontinue any part of it, including
          individual backends, endpoints, and API versions, and we will make reasonable efforts to give
          advance notice of changes that would break working integrations.
        </p>
        <p>
          Availability depends on third parties we do not control, including our hosting, database, and
          payment platforms and every compute provider in the catalog. Queue times, maintenance
          windows, calibration cycles, and outages at a provider are outside our control, and failover
          to another backend is offered on a best-effort basis where you have enabled it and an
          eligible alternative exists.
        </p>
        <p>
          Support during the pilot is provided by email at <Fill name="SUPPORT_EMAIL" />, through the{" "}
          <Link href="/contact">contact form</Link>, and through the in-console report form. We aim to
          respond promptly but do not commit to a response time.
        </p>
      </>
    ),
  },
  {
    id: "ip",
    title: "Intellectual property and feedback",
    body: (
      <>
        <p>
          We and our licensors own the Service and everything in it other than Customer Content:
          the software, the QCI Engine and its routing and pricing models, the transpilation pipeline,
          the documentation, the index methodology and published index data, and the QRouter and
          Quantum Compute Index names and marks. Subject to these Terms we grant you a limited,
          revocable, non-exclusive, non-transferable right to use the Service and the SDKs for their
          intended purpose. No other rights are granted, expressly or by implication.
        </p>
        <p>
          Open-source components distributed with the Service remain governed by their own licenses,
          which prevail over this section to the extent of any conflict.
        </p>
        <p>
          If you send us feedback, suggestions, bug reports, or feature requests, we may use them
          without restriction, attribution, or compensation. Feedback is not confidential, and you
          should not send us anything in feedback that you want to keep proprietary.
        </p>
      </>
    ),
  },
  {
    id: "confidentiality",
    title: "Confidentiality",
    body: (
      <>
        <p>
          Your circuit source, results, and execution history are confidential to your workspace. We
          will not disclose them to third parties except: to the compute provider needed to run the
          job; to the subprocessors listed in the{" "}
          <Link href="/privacy#subprocessors">Privacy Policy</Link> acting on our instructions; where
          you direct us to, including through webhook endpoints you configure; where required by law
          or a valid legal request; or where necessary to investigate a suspected breach of{" "}
          <a href="#acceptable-use">acceptable use</a>.
        </p>
        <p>
          Non-public information we share with you about the Service — including unreleased features,
          pricing models, and pilot documentation — is our confidential information and should be
          treated with the same care you would apply to your own confidential material.
        </p>
      </>
    ),
  },
  {
    id: "termination",
    title: "Suspension and termination",
    body: (
      <>
        <p>
          You may stop using the Service at any time and ask us to close your account by contacting{" "}
          <Fill name="SUPPORT_EMAIL" />.
        </p>
        <p>
          We may suspend or terminate your access, in whole or in part, with notice where practicable
          and immediately where necessary, if:
        </p>
        <ul>
          <li>
            you breach these Terms, in particular <a href="#acceptable-use">acceptable use</a> or{" "}
            <a href="#export-controls">export controls and sanctions</a>;
          </li>
          <li>your use threatens the security, integrity, or availability of the Service or a provider;</li>
          <li>a payment fails, is reversed, or is disputed;</li>
          <li>we are required to do so by law, by a competent authority, or by a compute provider; or</li>
          <li>we discontinue the pilot or the Service.</li>
        </ul>
        <p>
          On termination your right to use the Service ends immediately. Running jobs may be cancelled
          and their reservations released. We will make your data available for export for a reasonable
          period where we lawfully can and where termination was not for a serious breach, after which
          it may be deleted. Unused credit is handled under{" "}
          <a href="#refunds">refunds, expiry, and promotional credit</a>.
        </p>
        <p>
          Sections that by their nature should survive termination do survive it, including those
          covering your content and the license you grant us, export controls, intellectual property
          and feedback, confidentiality, disclaimers, limitation of liability, indemnification,
          governing law and dispute resolution, and the general terms.
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <>
        <p>
          Except where prohibited by law, the Service is provided{" "}
          <strong>as is and as available, without warranties of any kind</strong>, whether express,
          implied, or statutory. We specifically disclaim the implied warranties of merchantability,
          fitness for a particular purpose, title, and non-infringement.
        </p>
        <p>We do not warrant that:</p>
        <ul>
          <li>the Service will be uninterrupted, timely, secure, or error-free;</li>
          <li>routing decisions, quotes, transpiled programs, or index values will be accurate, optimal, or suitable for your purpose;</li>
          <li>results returned by a compute provider will be correct, reproducible, or scientifically valid;</li>
          <li>any specific backend will be available, or available to you under that provider&apos;s own eligibility rules; or</li>
          <li>defects will be corrected.</li>
        </ul>
        <p>
          Quantum hardware is probabilistic and noisy by nature. Variation between runs, decoherence,
          calibration drift, and provider-side errors are expected characteristics of the technology,
          not defects in the Service.
        </p>
        <p>
          Nothing in these Terms excludes liability that cannot lawfully be excluded, including
          liability for death or personal injury caused by negligence, or for fraud. If you are a
          consumer, your statutory rights are unaffected.
        </p>
      </>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <>
        <p>
          To the maximum extent permitted by law, neither party is liable to the other for indirect,
          incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost
          revenue, lost business, lost research time, loss of goodwill, or loss or corruption of data,
          even if advised that such damages were possible.
        </p>
        <p>
          To the maximum extent permitted by law, our total aggregate liability arising out of or
          relating to the Service and these Terms, whether in contract, tort (including negligence), or
          otherwise, will not exceed the greater of (a) the total amount you paid us for the Service in
          the twelve months immediately before the event giving rise to the claim, and (b){" "}
          <Fill name="LIABILITY_CAP_FLOOR" />.
        </p>
        <p>
          These limits do not apply to your obligation to pay amounts due, to either party&apos;s
          liability under <a href="#indemnity">indemnification</a>, or to liability that cannot be
          limited under applicable law. The
          limitations apply in the aggregate across all claims, and they survive any failure of an
          exclusive remedy.
        </p>
      </>
    ),
  },
  {
    id: "indemnity",
    title: "Indemnification",
    body: (
      <p>
        You will defend, indemnify, and hold harmless us and our officers, employees, and agents from
        and against any third-party claim, and any resulting losses, damages, liabilities, and
        reasonable legal costs, arising out of or relating to: your Customer Content; your use of the
        Service in breach of these Terms; your breach of <a href="#acceptable-use">acceptable use</a>{" "}
        or <a href="#export-controls">export controls and sanctions</a>; your violation of a
        compute provider&apos;s terms or eligibility rules; or your infringement of a third
        party&apos;s intellectual property or privacy rights. We will notify you of the claim, give you
        control of the defense (subject to our right to participate with our own counsel), and
        cooperate reasonably at your expense. You may not settle a claim in a way that imposes an
        obligation or admission on us without our written consent.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to the Service and to these Terms",
    body: (
      <>
        <p>
          We may update these Terms as the Service develops or as the law requires. The current version
          is always at this page, with the last-updated date at the top.
        </p>
        <p>
          For changes that materially reduce your rights or increase your obligations, we will give
          reasonable advance notice — by email to the address on your account, by an in-console notice,
          or both — before they take effect. Changes take effect on the date stated in the notice, and
          continuing to use the Service after that date means you accept them. If you do not accept a
          material change, stop using the Service and contact us about your remaining credit balance
          before the change takes effect.
        </p>
        <p>
          Non-material changes, such as clarifications and corrections, take effect when published.
        </p>
      </>
    ),
  },
  {
    id: "governing-law",
    title: "Governing law and dispute resolution",
    body: (
      <>
        <p>
          These Terms and any dispute arising out of or in connection with them or the Service,
          including non-contractual disputes, are governed by the laws of{" "}
          <Fill name="GOVERNING_LAW_JURISDICTION" />, without regard to its conflict-of-laws rules. The
          United Nations Convention on Contracts for the International Sale of Goods does not apply.
        </p>
        <p>
          The parties submit to the exclusive jurisdiction of{" "}
          <Fill name="DISPUTE_RESOLUTION_FORUM" /> for the resolution of any such dispute. Either party
          may seek injunctive or other equitable relief in any court of competent jurisdiction to
          protect its intellectual property or confidential information.
        </p>
        <p>
          Before starting formal proceedings, please contact us at <Fill name="LEGAL_NOTICES_EMAIL" />{" "}
          with a description of the dispute so we can try to resolve it informally within 30 days.
        </p>
        <p>
          If you are a consumer resident in the European Union, the United Kingdom, or another
          jurisdiction whose law gives you the right to bring proceedings in your place of residence
          and to the protection of mandatory local consumer rules, nothing in this section removes that
          right.
        </p>
      </>
    ),
  },
  {
    id: "general",
    title: "General terms",
    body: (
      <>
        <p>
          <strong>Entire agreement.</strong> These Terms and the Privacy Policy are the entire
          agreement between you and us about the Service and replace any prior understanding on that
          subject.
        </p>
        <p>
          <strong>Severability.</strong> If a provision is held unenforceable, it is modified to the
          minimum extent necessary or severed, and the rest remains in force.
        </p>
        <p>
          <strong>No waiver.</strong> Not enforcing a provision is not a waiver of the right to enforce
          it later.
        </p>
        <p>
          <strong>Assignment.</strong> You may not assign these Terms without our written consent. We
          may assign them to an affiliate or in connection with a merger, acquisition, or sale of
          assets, on notice to you.
        </p>
        <p>
          <strong>Force majeure.</strong> Neither party is liable for a delay or failure caused by
          events beyond its reasonable control, including provider outages, infrastructure failures,
          network attacks, natural events, and acts of government.
        </p>
        <p>
          <strong>Notices.</strong> We may give notice by email to the address on your account or by
          posting in the console. Send formal notices to us at <Fill name="LEGAL_NOTICES_EMAIL" /> and
          to <Fill name="COMPANY_ADDRESS" />.
        </p>
        <p>
          <strong>Relationship.</strong> These Terms do not create a partnership, joint venture, agency,
          or employment relationship, and there are no third-party beneficiaries.
        </p>
      </>
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
            General and account support: <Fill name="SUPPORT_EMAIL" /> or the{" "}
            <Link href="/contact">contact form</Link>
          </li>
          <li>
            Legal notices: <Fill name="LEGAL_NOTICES_EMAIL" />
          </li>
          <li>
            Security reports: <Fill name="SECURITY_EMAIL" />
          </li>
          <li>
            Privacy requests: <Fill name="PRIVACY_EMAIL" /> — see the{" "}
            <Link href="/privacy#your-rights">Privacy Policy</Link>
          </li>
        </ul>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Service"
      lede={
        <>
          These Terms explain what QRouter does, what you may and may not do with it, how prepaid
          credits and quotes work, and how responsibility is divided between us, you, and the quantum
          compute providers that actually run your circuits.
        </>
      }
      meta={[
        { term: "Last updated", detail: LAST_UPDATED },
        /* TODO(legal): set the date these Terms come into force. */
        { term: "Effective", detail: <Fill name="EFFECTIVE_DATE" /> },
        { term: "Applies to", detail: "The QRouter console, API, SDKs, and documentation" },
        { term: "Related", detail: <Link href="/privacy">Privacy Policy</Link> },
      ]}
      sections={SECTIONS}
    />
  );
}
