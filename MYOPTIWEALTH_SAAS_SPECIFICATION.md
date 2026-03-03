# MYOPTIWEALTH — SaaS Architecture & Product Specification

## 1. Vision

MyOptiwealth est une application SaaS premium destinée aux cabinets de conseil pour gérer :

* CRM (sociétés / interlocuteurs)
* Projets structurés avec workflow fixe
* Tâches (kanban + priorités)
* Calendrier + génération ICS
* Gestion documentaire cloud
* Signature électronique avancée
* Emails IMAP intégrés
* Module financier complet
* Timesheet
* Audit log
* Multi-tenant SaaS sécurisé

Positionnement produit :
Stripe × Notion × Cabinet de conseil premium.

---

## 2. Stack Technique

Backend:

* NestJS
* TypeScript
* Prisma ORM v6
* PostgreSQL
* JWT auth
* bcrypt
* AES-256 encryption for secrets

Frontend:

* Next.js
* TypeScript
* Tailwind CSS
* ShadCN UI
* Responsive + PWA ready

Infrastructure:

* VPS Ubuntu
* PostgreSQL local
* Backend port 7000
* Nginx reverse proxy (443)
* HTTPS
* PM2

---

## 3. Architecture SaaS

### Multi-Tenant Model

Entity: Workspace

* A user can belong to multiple workspaces.
* Workspace is the tenant boundary.
* All business data must include workspaceId.

### Platform Level

Role:

* isPlatformAdmin (boolean on User)

Platform admin can:

* Create workspace
* Delete workspace
* Supervise system

---

## 4. Roles (V1)

Workspace roles (fixed initially):

* ADMIN
* COLLABORATOR
* VIEWER

Future: customizable roles per workspace.

---

## 5. Security Requirements

* bcrypt salt rounds: 12
* JWT access token: 15 minutes
* Refresh token: 7 days
* Refresh token stored hashed
* 2FA TOTP required (Google Authenticator compatible)
* Audit log mandatory
* AES encryption for:

  * IMAP passwords
  * Signature API keys

Never expose:

* passwordHash
* refreshTokenHash
* encrypted secrets

---

## 6. Database Core (Already Implemented)

Models:

User
Workspace
WorkspaceSettings
UserWorkspaceRole
AuditLog

All future business tables must include:
workspaceId (mandatory)

---

## 7. Workflow Architecture

All projects follow a strict linear workflow with 6 fixed phases:

1. Qualification & Cadrage
2. Formalisation & Engagement
3. Analyse & Structuration
4. Présentation & Ajustements
5. Mise en œuvre
6. Clôture & Suivi

Each new project automatically generates:

* All 6 phases
* Standard sub-steps
* Template-based tasks
* Variant modules depending on mission type

Template logic:

* Global base template
* Optional variants activated per project type

---

## 8. Core Modules

### 8.1 CRM

Entities:

* Societies
* Contacts

Relations:

* One society → many projects
* One society → many contacts

Contacts can:

* Belong to a society
* Have role per project
* Be linked to tasks
* Be linked to emails
* Be linked to documents

---

### 8.2 Projects

Project structure:

Header:

* Name
* Society
* Current phase
* % progress
* Honoraires prévus
* Facturé
* Encaissé
* Marge estimée

Views:

* Vertical timeline (6 phases)
* Phase tabs
* Kanban tasks
* Documents
* Emails
* Finance

---

### 8.3 Tasks

Task fields:

* description
* priority (1–3)
* status (todo, in_progress, waiting, done)
* dueDate
* assigned internal user
* visibleToClient (boolean)
* linkedPhase
* linkedContacts
* linkedEmails

Kanban view required.

---

### 8.4 Calendar

Calendar must support:

* Meetings
* Tasks deadlines
* Internal events
* External events
* Visio link
* Alerts
* Export ICS

ICS generation required for:

* Event
* Task deadline
* Full project
* Weekly export

Future: CalDAV sync.

---

### 8.5 Email Integration

IMAP per workspace:

WorkspaceSettings:

* imapHost
* imapPort
* imapUser
* imapPasswordEncrypted

System must:

* Fetch emails
* Attach to project via:

  * email match
  * project tag
* Store metadata
* Allow manual linking

---

### 8.6 Document Management

Cloud storage (external provider).

Features:

* Organized by Project
* Linked to Society
* Linked to Contact
* Versioning
* Status:

  * draft
  * sent
  * signed
  * archived

Must support:

* Signature advanced (Yousign / DocuSign API)
* Store signature certificate
* Track signature state

---

### 8.7 Financial Module (V1 included)

Per project:

* Devis
* Validation
* Factures
* Multi-échéances
* Encaissements
* Relances
* Status tracking

Timesheet:

* Time per task
* Time per phase
* Time per collaborator
* Rentability calculation

KPIs:

* CA facturé
* CA encaissé
* Temps valorisé
* Marge estimée

---

## 9. Dashboard

Homepage priority order:

1. Tasks today
2. Global KPIs
3. Calendar preview

Mobile:

* Swipe between sections

---

## 10. UX Requirements

* Left sidebar navigation
* Top workspace selector
* Workspace switcher dropdown
* Premium minimalist design
* Financial seriousness
* High-end consulting branding
* Dark/light ready

---

## 11. Auth Module Requirements

Register flow:

POST /auth/register

Input:

* email
* password
* workspaceName

Process:

* Create User
* Create Workspace
* Create WorkspaceSettings
* Assign ADMIN role
* Generate JWT
* Log audit

Login flow:

POST /auth/login

* Validate password
* Return tokens
* Log audit

---

## 12. Audit Logging

Must log:

* Login
* Logout
* Workspace switch
* User creation
* Project creation
* Financial changes
* Document signature events
* Role change

AuditLog:

* workspaceId
* userId
* action
* metadata (JSON)
* createdAt

Immutable.

---

## 13. Future SaaS Ready

Must support:

* Multiple workspaces per user
* Workspace selection at login
* Workspace switch live
* Isolation strict by workspaceId
* Possible subscription model later

---

## 14. Development Constraints

* No business logic in controllers
* Prisma only via service
* DTO with validation
* No any types
* Strict TypeScript
* Clean modular architecture

---

## 15. Performance & Scalability

Design for:

* 50+ workspaces
* 100+ projects per workspace
* Heavy document storage
* Email synchronization
* Financial reporting

PostgreSQL optimized
Indexes required on:

* workspaceId
* projectId
* userId

---

END OF SPECIFICATION
