"""The api's tables, written once in SQLAlchemy Core for PostgreSQL and, in tests, SQLite."""

from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Engine,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Numeric,
    String,
    Table,
    Text,
    create_engine,
    text,
)

# Money is held to the cent and read back as a float.
Money = Numeric(12, 2, asdecimal=False)

metadata = MetaData()

customers = Table(
    "customers",
    metadata,
    Column("customer_id", String(20), primary_key=True),
    Column("name", String(200), nullable=False),
    # The email a customer signs in with, lower-cased.
    Column("email", String(320), unique=True),
    Column("record", JSON, nullable=False),
    # Where the customer's payouts go: a PayID (an email, a mobile number or an ABN).
    Column("payid", String(320)),
)

policies = Table(
    "policies",
    metadata,
    Column("policy_id", String(20), primary_key=True),
    Column("customer_id", String(20), ForeignKey("customers.customer_id"), nullable=False),
    Column("record", JSON, nullable=False),
)

# The AI engineers who evaluate, improve and red-team the agent, in their own console.
engineers = Table(
    "engineers",
    metadata,
    Column("engineer_id", String(20), primary_key=True),
    Column("name", String(200), nullable=False),
    Column("role", String(100), nullable=False),
    Column("email", String(320), nullable=False, unique=True),
)

handlers = Table(
    "handlers",
    metadata,
    Column("handler_id", String(20), primary_key=True),
    Column("name", String(200), nullable=False),
    Column("role", String(100), nullable=False),
    Column("email", String(320), nullable=False, unique=True),
    Column("can_approve_over_limit", Boolean, nullable=False),
)

claims = Table(
    "claims",
    metadata,
    Column("claim_id", String(20), primary_key=True),
    Column("policy_id", String(20), ForeignKey("policies.policy_id"), nullable=False),
    Column("customer_id", String(20), ForeignKey("customers.customer_id"), nullable=False),
    Column("claim_type", String(50), nullable=False),
    Column("submitted_on", String(10), nullable=False),
    Column("incident_date", String(10), nullable=False),
    Column("incident_location", String(200), nullable=False),
    Column("summary", Text, nullable=False),
    Column("story", Text, nullable=False),
    Column("items", JSON, nullable=False),
    Column("amount_claimed", Money, nullable=False),
    Column("documents", JSON, nullable=False),
    Column("status", String(30), nullable=False),
    # The thread of the attempt in progress, and how many attempts there have been.
    Column("thread_id", String(100)),
    Column("attempts", Integer, nullable=False, default=0),
    # Where the claim came from: the seeded queue or a customer's own submission.
    Column("source", String(20), nullable=False, default="seeded"),
    # When the customer asked for a person to review the claim, and what they said.
    Column("review_requested_at", String(32)),
    Column("review_note", Text),
    # An evaluation's copy: the run it belongs to and the labelled claim it copies.
    Column("run_id", Integer, index=True),
    Column("original_claim_id", String(20)),
    # The claim agent's configuration version the current attempt works with.
    Column("config_version", Integer),
    # When the agent last said it was still working the claim, and how often it was carried on.
    Column("heartbeat_at", String(32)),
    Column("recoveries", Integer, nullable=False, default=0),
)

# The labelled claims evaluations copy, with the handlers' decisions. No route the agent can
# call returns a label, except the evaluation set's misses the improver reads; never held-out.
labelled_claims = Table(
    "labelled_claims",
    metadata,
    Column("claim_id", String(20), primary_key=True),
    Column("label_set", String(20), nullable=False),
    Column("tiny", Boolean, nullable=False),
    Column("claim", JSON, nullable=False),
    Column("label", JSON, nullable=False),
    # The AI engineer who added a live claim a handler disagreed on, and when; none if seeded.
    Column("added_by", String(200)),
    Column("added_at", String(32)),
)

# The claim agent's configuration: its instructions, model and reasoning effort, in versions.
configurations = Table(
    "configurations",
    metadata,
    Column("version", Integer, primary_key=True),
    Column("instructions", Text, nullable=False),
    Column("model", String(50), nullable=False),
    Column("effort", String(10), nullable=False),
    Column("reason", Text, nullable=False),
    Column("diff", Text, nullable=False),
    # proposed, rejected, candidate, kept or rolled_back; the current one is a setting.
    Column("status", String(20), nullable=False),
    Column("parent_version", Integer),
    Column("proposed_by", String(200), nullable=False),
    Column("reviewed_by", String(200)),
    Column("created_at", String(32), nullable=False),
)

# Dispatches over a labelled set: who started them, how, and their scores when finished.
runs = Table(
    "runs",
    metadata,
    Column("run_id", Integer, primary_key=True, autoincrement=True),
    Column("label_set", String(20), nullable=False),
    Column("size", String(10), nullable=False),
    Column("concurrency", Integer, nullable=False),
    Column("config_version", Integer, nullable=False),
    Column("round_id", Integer),
    Column("status", String(20), nullable=False),
    Column("started_by", String(200), nullable=False),
    Column("started_at", String(32), nullable=False),
    Column("finished_at", String(32)),
    Column("scores", JSON),
    # When the judge took the run's explanations to grade; none if it was never asked.
    Column("grading_since", String(32)),
)

# A senior handler's dispatch: claim agents working the claims that were waiting when it started.
dispatches = Table(
    "dispatches",
    metadata,
    Column("dispatch_id", Integer, primary_key=True, autoincrement=True),
    Column("concurrency", Integer, nullable=False),
    Column("claim_ids", JSON, nullable=False),
    # running, finished or stopped
    Column("status", String(20), nullable=False),
    Column("started_by", String(200), nullable=False),
    Column("started_at", String(32), nullable=False),
    Column("finished_at", String(32)),
    Column("stopped_reason", String(500)),
)

# The judge's grade of each evaluated copy's explanation against the handler's: shown beside a
# run's scores, never used to keep a version or decide a claim. A null score is "not graded".
grades = Table(
    "grades",
    metadata,
    Column("claim_id", String(20), ForeignKey("claims.claim_id"), primary_key=True),
    Column("run_id", Integer, ForeignKey("runs.run_id"), nullable=False, index=True),
    Column("score", Integer),
    Column("same_grounds", Boolean),
    Column("same_section", Boolean),
    Column("note", String(200), nullable=False),
    Column("cost", Numeric(12, 6, asdecimal=False), nullable=False),
    Column("graded_at", String(32), nullable=False),
)

# Improvement rounds: the baseline runs, the improver's proposal, the review and the verdict.
rounds = Table(
    "rounds",
    metadata,
    Column("round_id", Integer, primary_key=True, autoincrement=True),
    Column("status", String(30), nullable=False),
    Column("baseline_version", Integer, nullable=False),
    Column("candidate_version", Integer),
    Column("baseline_eval_run", Integer),
    Column("baseline_held_run", Integer),
    Column("candidate_held_run", Integer),
    Column("proposal", JSON),
    Column("review", JSON),
    Column("verdict", JSON),
    Column("improver_cost", Numeric(12, 6, asdecimal=False), nullable=False, default=0),
    Column("spend_limit", Money, nullable=False),
    Column("started_by", String(200), nullable=False),
    Column("started_at", String(32), nullable=False),
)

# Receipts a customer uploaded, stored under a random name by the storage module.
receipts = Table(
    "receipts",
    metadata,
    Column("receipt_id", String(32), primary_key=True),
    Column("claim_id", String(20), ForeignKey("claims.claim_id"), nullable=False, index=True),
    Column("media_type", String(50), nullable=False),
    Column("size", Integer, nullable=False),
    Column("uploaded_at", String(32), nullable=False),
    # Fingerprints for the duplicate check: the bytes' SHA-256, and an image's perceptual hash.
    Column("sha256", String(64), index=True),
    Column("phash", String(16)),
    # The request it answers, when the customer sent it for something we asked for.
    Column("request_id", Integer),
)

# The current decision on a claim, one at most. A decision sent back moves to sent_back.
decisions = Table(
    "decisions",
    metadata,
    Column("claim_id", String(20), ForeignKey("claims.claim_id"), primary_key=True),
    Column("decision", String(10), nullable=False),
    Column("payout", Money, nullable=False),
    Column("calculation", JSON),
    Column("section", Text, nullable=False),
    Column("reason", Text, nullable=False),
    Column("decided_by", String(200), nullable=False),
    Column("decided_at", String(32), nullable=False),
    Column("manual_version", String(20), nullable=False),
    Column("approval_limit", Money, nullable=False),
    Column("hold_reason", Text),
    Column("signed_off_by", String(200)),
    Column("signed_off_at", String(32)),
    Column("signed_off_by_id", String(20)),
    # What the agent checked, each line with its result and the source it relied on.
    Column("checklist", JSON),
    # A senior handler's override: the decision before, the reason code, note, who and when.
    Column("override", JSON),
)

sent_back = Table(
    "sent_back",
    metadata,
    Column("sent_back_id", Integer, primary_key=True, autoincrement=True),
    Column("claim_id", String(20), ForeignKey("claims.claim_id"), nullable=False, index=True),
    Column("decision", JSON, nullable=False),
    Column("note", Text, nullable=False),
    Column("sent_back_by", String(200), nullable=False),
    Column("sent_back_at", String(32), nullable=False),
    Column("sent_back_by_id", String(20)),
)

# One payment per claim, ever: the unique key is what stops a claim being paid twice.
payments = Table(
    "payments",
    metadata,
    Column("claim_id", String(20), ForeignKey("claims.claim_id"), primary_key=True),
    Column("amount", Money, nullable=False),
    Column("paid_at", String(32), nullable=False),
    Column("signed_off_by", String(200)),
    Column("signed_off_by_id", String(20)),
    # Where it was sent, masked: "PayID o***@example.com", or None before PayIDs.
    Column("paid_to", String(200)),
)

# What we asked a customer for on a claim, in words for them, and when they sent it.
customer_requests = Table(
    "customer_requests",
    metadata,
    Column("request_id", Integer, primary_key=True, autoincrement=True),
    Column("claim_id", String(20), ForeignKey("claims.claim_id"), nullable=False, index=True),
    Column("text", String(300), nullable=False),
    Column("asked_by", String(200), nullable=False),
    Column("asked_at", String(32), nullable=False),
    Column("fulfilled_at", String(32)),
)

# The messages we send a customer, by email or text. Locally this is the outbox itself; in the
# cloud a sender delivers each one.
notices = Table(
    "notices",
    metadata,
    Column("notice_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "customer_id", String(20), ForeignKey("customers.customer_id"), nullable=False, index=True
    ),
    Column("claim_id", String(20), ForeignKey("claims.claim_id")),
    Column("channel", String(10), nullable=False),
    Column("subject", String(200), nullable=False),
    Column("body", Text, nullable=False),
    # The customer-facing status it announced, so a status is announced once.
    Column("status", String(30)),
    Column("sent_at", String(32), nullable=False),
)

# The letter a handler sent a customer about a claim's decision, one a claim.
letters = Table(
    "letters",
    metadata,
    Column("claim_id", String(20), ForeignKey("claims.claim_id"), primary_key=True),
    Column("subject", String(200), nullable=False),
    Column("body", Text, nullable=False),
    Column("drafted_by_ai", Boolean, nullable=False),
    Column("sent_by", String(200), nullable=False),
    Column("sent_at", String(32), nullable=False),
)

# A customer's thumbs up or down on one of Wattle's answers or on a decision's explanation. The
# comment and question are the customer's own words: shown as plain text, never sent to a model.
feedback = Table(
    "feedback",
    metadata,
    Column("feedback_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "customer_id", String(20), ForeignKey("customers.customer_id"), nullable=False, index=True
    ),
    # answer or decision
    Column("subject", String(10), nullable=False),
    Column("claim_id", String(20), ForeignKey("claims.claim_id")),
    Column("helpful", Boolean, nullable=False),
    Column("comment", String(300)),
    Column("question", String(300)),
    Column("created_at", String(32), nullable=False),
    # One vote per customer on each decision's explanation, however two requests race.
    Index(
        "uq_feedback_decision_vote",
        "customer_id",
        "claim_id",
        unique=True,
        postgresql_where=text("subject = 'decision'"),
        sqlite_where=text("subject = 'decision'"),
    ),
)

# A customer's claim in progress, saved so they can finish it later: one at a time.
claim_drafts = Table(
    "claim_drafts",
    metadata,
    Column("customer_id", String(20), ForeignKey("customers.customer_id"), primary_key=True),
    Column("data", JSON, nullable=False),
    Column("updated_at", String(32), nullable=False),
)

# A claim's latest payout calculation, on the thread of the attempt it was made in.
calculations = Table(
    "calculations",
    metadata,
    Column("claim_id", String(20), ForeignKey("claims.claim_id"), primary_key=True),
    Column("thread_id", String(100), nullable=False),
    Column("lines", JSON, nullable=False),
    Column("payout", Money, nullable=False),
    Column("calculated_at", String(32), nullable=False),
)

steps = Table(
    "steps",
    metadata,
    Column("step_id", Integer, primary_key=True, autoincrement=True),
    Column("claim_id", String(20), ForeignKey("claims.claim_id"), nullable=False, index=True),
    Column("thread_id", String(100)),
    Column("kind", String(20), nullable=False),
    Column("content", Text, nullable=False),
    Column("sources", JSON, nullable=False),
    Column("created_at", String(32), nullable=False),
)

model_calls = Table(
    "model_calls",
    metadata,
    Column("call_id", Integer, primary_key=True, autoincrement=True),
    Column("claim_id", String(20), ForeignKey("claims.claim_id"), nullable=False, index=True),
    Column("thread_id", String(100)),
    Column("model", String(100), nullable=False),
    Column("input_tokens", Integer, nullable=False),
    Column("output_tokens", Integer, nullable=False),
    Column("cost", Numeric(12, 6, asdecimal=False), nullable=False),
    Column("latency_ms", Integer),
    Column("created_at", String(32), nullable=False),
)

# Settings a senior handler can change, each with who changed it and when.
settings = Table(
    "settings",
    metadata,
    Column("key", String(50), primary_key=True),
    Column("value", JSON, nullable=False),
    Column("changed_by", String(200), nullable=False),
    Column("changed_at", String(32), nullable=False),
)

# Every change to a setting, with the handler who made it, for the audit trail.
setting_changes = Table(
    "setting_changes",
    metadata,
    Column("change_id", Integer, primary_key=True, autoincrement=True),
    Column("key", String(50), nullable=False),
    Column("value", JSON, nullable=False),
    Column("changed_by", String(200), nullable=False),
    Column("changed_by_id", String(20), nullable=False),
    Column("changed_at", String(32), nullable=False),
    # The value before, and why it changed; the payouts switch keeps its reason in its value.
    Column("old_value", JSON),
    Column("reason", String(200)),
)

# Each run of the red-team suite, newest last.
redteam_reports = Table(
    "redteam_reports",
    metadata,
    Column("report_id", Integer, primary_key=True, autoincrement=True),
    Column("run_at", String(32), nullable=False),
    Column("run_by", String(200), nullable=False),
    Column("results", JSON, nullable=False),
)

# What the api loads from the context layer when seeding: the plans and document versions.
reference = Table(
    "reference",
    metadata,
    Column("key", String(50), primary_key=True),
    Column("value", JSON, nullable=False),
)


def now() -> str:
    """The time now, in UTC, as ISO 8601."""
    return datetime.now(UTC).isoformat(timespec="seconds")


# Supabase's transaction pooler (tier 2) gives each transaction any connection: none are prepared.
NO_PREPARED_STATEMENTS = {"prepare_threshold": None}


def make_engine(url: str) -> Engine:
    """An engine for the database at the url. Errors never carry the statement's values,
    which can hold customers' personal data. No prepared statements, for a transaction pooler.
    On DSQL, each connection signs in with an IAM token and is recycled within the hour."""
    from undercover_api.dsql import RECYCLE_SECONDS, is_dsql, sign_in_with_iam  # noqa: PLC0415

    extra = NO_PREPARED_STATEMENTS if url.startswith("postgresql+psycopg") else {}
    if not is_dsql(url):
        return create_engine(url, pool_pre_ping=True, hide_parameters=True, connect_args=extra)
    engine = create_engine(
        url,
        pool_pre_ping=True,
        pool_recycle=RECYCLE_SECONDS,
        hide_parameters=True,
        connect_args=extra,
    )
    sign_in_with_iam(engine)
    return engine
