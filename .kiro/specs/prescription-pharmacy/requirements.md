# Requirements Document

## Introduction

This feature adds **structured prescription management with pharmacy integration** to MediBook. Today a prescription is a single free-text field (`consultation_notes.prescription`) with no structure, no lifecycle, and no path to fulfillment. This feature turns prescriptions into first-class, structured medical records that a doctor issues, a patient can view/download/share, and a partner pharmacy can receive, price, and fulfill — while preserving MediBook's existing security posture (RLS on every table, per-appointment consent, audit logging, AAL2 gating for sensitive data).

The design builds on existing infrastructure: the `appointments` and `consultation_notes` tables, the `doctors`/`profiles`/`hospitals` model, the `notifications` + `push_subscriptions` stack, Razorpay payments (migration 022), medical-record audit logging (migration 021), and the migration-017 atomic-RPC / advisory-lock concurrency patterns. Because prescriptions are protected health information (PHI) and can authorize dispensing of controlled substances, correctness, tamper-resistance, and auditability are first-order concerns.

Pharmacy integration is designed **provider-agnostic** behind an adapter boundary so MediBook can support (a) in-house/partner pharmacies onboarded on the platform and (b) external pharmacy networks via API, without leaking a specific vendor into the core schema.

## Glossary

- **MediBook_System**: The overall application — React frontend, Supabase Auth, Postgres with RLS, and Edge Functions.
- **Prescription**: A structured, doctor-authored medical order tied to one appointment, containing one or more Prescription_Items plus metadata (issue date, validity, diagnosis code, status).
- **Prescription_Item**: A single medication line — drug name, form, strength, dosage, frequency, duration, quantity, and instructions.
- **Prescriber**: A DOCTOR who authors and signs a Prescription.
- **Patient**: The profile the Prescription is issued to.
- **Pharmacy**: A dispensing entity registered on the platform (a new role/entity) or represented via an external adapter, capable of receiving and fulfilling a Prescription.
- **Pharmacy_Order**: A patient-initiated request to fulfill a Prescription at a chosen Pharmacy, with its own lifecycle (RECEIVED → PRICED → CONFIRMED → READY → DISPENSED / REJECTED / CANCELLED).
- **Pharmacy_Adapter**: A server-side integration boundary (Edge Function) that normalizes communication with a specific pharmacy backend.
- **Formulary**: The catalog of dispensable medications a Pharmacy stocks, used for validation, substitution, and pricing.
- **Dispense_Record**: An immutable log entry recording that a Pharmacy dispensed some/all items of a Prescription.
- **Prescription_Token**: A signed, single-purpose reference a patient can share with a Pharmacy to grant scoped read access to one Prescription.
- **Controlled_Medication**: A medication flagged as regulated, requiring stricter authoring, dispensing, and audit rules.
- **AAL2**: Authenticator Assurance Level 2 — a session that has satisfied MFA, required for sensitive actions per the existing MFA feature.

## Requirements

### Requirement 1: Structured Prescription Authoring

**User Story:** As a doctor, I want to issue a structured prescription with discrete medication lines during or after a consultation, so that the patient and any pharmacy receive unambiguous, machine-readable orders.

#### Acceptance Criteria

1. WHEN a Prescriber closes or edits a consultation for an appointment they own, THE MediBook_System SHALL allow creation of one Prescription linked to that appointment.
2. WHEN a Prescriber adds a Prescription_Item, THE MediBook_System SHALL require drug name, dosage, frequency, and duration, and SHALL accept optional form, strength, quantity, and free-text instructions.
3. THE MediBook_System SHALL allow a Prescription to contain one or more Prescription_Items and SHALL reject a Prescription with zero items.
4. WHEN a Prescriber finalizes a Prescription, THE MediBook_System SHALL record the prescriber id, patient id, appointment id, issue timestamp, and a validity/expiry date.
5. WHERE a Prescription_Item references a Controlled_Medication, THE MediBook_System SHALL require the Prescriber's session to be at AAL2 before the Prescription can be finalized.
6. WHEN a Prescription is finalized, THE MediBook_System SHALL set its status to ISSUED and SHALL prevent further edits to items, allowing only a superseding revision or a cancellation.
7. IF a Prescriber cancels an ISSUED Prescription, THEN THE MediBook_System SHALL set its status to CANCELLED, record the reason and timestamp, and notify the patient.
8. THE MediBook_System SHALL retain the existing free-text `consultation_notes.prescription` field for backward compatibility and SHALL NOT require migrating historical notes into structured items.

### Requirement 2: Patient Access, Download, and Sharing

**User Story:** As a patient, I want to view, download, and share my prescriptions, so that I can get medications from a pharmacy of my choice.

#### Acceptance Criteria

1. WHEN a Patient opens their prescriptions view, THE MediBook_System SHALL list all Prescriptions issued to them, most recent first, with status and prescriber.
2. WHEN a Patient opens a single Prescription, THE MediBook_System SHALL display all Prescription_Items, the prescriber, the issuing hospital, and validity.
3. WHEN a Patient requests a downloadable copy, THE MediBook_System SHALL generate a PDF containing the prescriber, patient, items, issue date, and a verification reference.
4. WHERE a Patient chooses to share a Prescription with a Pharmacy, THE MediBook_System SHALL issue a scoped, expiring Prescription_Token that grants read-only access to that one Prescription.
5. THE RLS_Policy set SHALL ensure a Patient can read only Prescriptions where they are the patient, and SHALL deny access to other patients' Prescriptions.
6. IF a session is at AAL1 for a patient who has MFA enrolled, THEN THE MediBook_System SHALL require a step-up to AAL2 before revealing full Prescription detail, consistent with existing sensitive-data gating.

### Requirement 3: Pharmacy Registration and Formulary

**User Story:** As a pharmacy operator, I want to register my pharmacy and manage my formulary, so that I can receive and fulfill prescriptions on the platform.

#### Acceptance Criteria

1. THE MediBook_System SHALL support a Pharmacy entity with name, license number, address, contact, and active status.
2. WHERE a Pharmacy is onboarded, THE MediBook_System SHALL follow the existing collaboration/onboarding approval flow before the Pharmacy becomes active.
3. WHEN a Pharmacy operator manages their Formulary, THE MediBook_System SHALL allow adding, updating, and deactivating medications with price and availability.
4. THE RLS_Policy set SHALL ensure a Pharmacy operator can read and write only their own Pharmacy's Formulary and Pharmacy_Orders.
5. IF a non-pharmacy caller attempts to read or mutate Formulary or Pharmacy_Order data, THEN THE RLS_Policy SHALL deny the request.

### Requirement 4: Pharmacy Order Lifecycle and Fulfillment

**User Story:** As a patient, I want to send a prescription to a pharmacy and track its fulfillment, so that I know when my medication is priced and ready.

#### Acceptance Criteria

1. WHEN a Patient submits a Prescription to a chosen active Pharmacy, THE MediBook_System SHALL create a Pharmacy_Order in status RECEIVED linked to the Prescription and Pharmacy.
2. WHEN a Pharmacy prices a Pharmacy_Order, THE MediBook_System SHALL record per-item price and availability and set the order status to PRICED, notifying the patient.
3. WHERE a Formulary lacks an exact item, THE MediBook_System SHALL allow the Pharmacy to propose a substitution that the Patient must approve before the item is dispensed.
4. WHEN a Patient confirms a PRICED order, THE MediBook_System SHALL set the status to CONFIRMED and MAY initiate payment via the existing Razorpay flow.
5. WHEN a Pharmacy marks items dispensed, THE MediBook_System SHALL create an immutable Dispense_Record and set the order status to DISPENSED (or PARTIALLY_DISPENSED).
6. THE MediBook_System SHALL enforce that the total dispensed quantity per Prescription_Item never exceeds the prescribed quantity across all Dispense_Records.
7. WHERE a Prescription_Item is a Controlled_Medication, THE MediBook_System SHALL allow at most the prescribed quantity to be dispensed exactly once and SHALL block re-dispensing.
8. IF two Pharmacy operators attempt to dispense the same Pharmacy_Order concurrently, THEN THE MediBook_System SHALL serialize the operation so that quantities are never double-counted.
9. WHEN a Pharmacy rejects an order, THE MediBook_System SHALL set the status to REJECTED with a reason and notify the patient, leaving the Prescription available to send elsewhere.

### Requirement 5: External Pharmacy Integration Boundary

**User Story:** As a platform operator, I want pharmacy integrations behind a normalized adapter, so that I can support external pharmacy networks without changing the core schema.

#### Acceptance Criteria

1. THE MediBook_System SHALL route all external pharmacy communication through a Pharmacy_Adapter Edge Function and SHALL NOT call external pharmacy APIs directly from the browser.
2. THE Pharmacy_Adapter SHALL read provider credentials from Supabase secrets and SHALL NOT expose them to the client.
3. WHEN an external Pharmacy sends a status update, THE Pharmacy_Adapter SHALL validate the request authenticity before mutating any Pharmacy_Order.
4. THE Pharmacy_Adapter SHALL map external order states onto the canonical Pharmacy_Order lifecycle and SHALL treat unknown states as no-ops with an audit entry.
5. WHERE an external call fails, THE MediBook_System SHALL keep the Pharmacy_Order in its last known state and SHALL surface a retryable error rather than a partial update.

### Requirement 6: Security, Audit, and Compliance

**User Story:** As a security administrator, I want every prescription and dispensing action authorized and logged, so that PHI access and controlled-substance handling are auditable.

#### Acceptance Criteria

1. THE MediBook_System SHALL enable RLS on all new tables and SHALL scope access by role: prescriber (own prescriptions), patient (own prescriptions), pharmacy (orders sent to them), admin (read for oversight).
2. WHEN any party reads Prescription detail, creates a Pharmacy_Order, or records a Dispense_Record, THE MediBook_System SHALL write an audit-log entry with actor, action, target, and timestamp, reusing the migration-021 audit pattern.
3. THE MediBook_System SHALL store all user-entered prescription text sanitized to prevent stored XSS, consistent with existing input-sanitization rules.
4. A Prescription_Token SHALL grant read-only access to exactly one Prescription, SHALL expire, and SHALL be revocable by the Patient.
5. IF a Prescription_Token is expired or revoked, THEN THE MediBook_System SHALL deny access using it.
6. THE MediBook_System SHALL prevent a Pharmacy from reading any Prescription for which it has neither a Pharmacy_Order nor a valid Prescription_Token.

### Requirement 7: Notifications

**User Story:** As a patient, I want to be notified about prescription and order events, so that I can act without polling the app.

#### Acceptance Criteria

1. WHEN a Prescription is issued or cancelled, THE MediBook_System SHALL send the patient an in-app notification, reusing the existing notifications infrastructure.
2. WHEN a Pharmacy_Order changes to PRICED, CONFIRMED, READY, DISPENSED, or REJECTED, THE MediBook_System SHALL notify the patient of the new state.
3. WHERE a Patient has push subscriptions, THE MediBook_System SHALL deliver order-ready notifications via the existing push pipeline.
4. THE MediBook_System SHALL define new notification types without breaking existing notification rendering.
