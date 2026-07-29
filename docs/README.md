# MediBook Documentation

Welcome to the comprehensive documentation for the MediBook hospital appointment and management system.

## Documentation Index

### 📚 Core Documentation

- **[../README.md](../README.md)** - Project overview, quick start, and basic setup
- **[FEATURES.md](./FEATURES.md)** - Detailed feature documentation including:
  - Smart Swap Slot Exchange
  - Live Queue & ETA Tracking
  - Multi-Factor Authentication (MFA/TOTP)
  - Medical History Vault
  - Hospital Reviews & Ratings
  - Security features

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - System architecture and technical design:
  - High-level architecture overview
  - Technology stack decisions
  - Concurrency model (race-safe booking)
  - Data flow patterns
  - Real-time features
  - Timezone handling

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Complete production deployment guide:
  - Prerequisites and account setup
  - Environment configuration
  - Database migration steps (001-034)
  - Edge function deployment
  - Frontend deployment (Vercel/Netlify/custom)
  - Post-deployment verification

### 🔐 Security & API

- **[SECURITY.md](./SECURITY.md)** - Comprehensive security documentation:
  - RLS policies deep-dive
  - Input sanitization strategy
  - Rate limiting implementation
  - Audit logging
  - Penetration test hardening
  - AAL2 gating for MFA
  - HIPAA/GDPR considerations
  - Incident response plan

- **[API.md](./API.md)** - Complete API reference:
  - RPC function signatures
  - Request/response examples
  - Error codes and handling
  - Rate limits
  - Authentication requirements
  - Real-time subscriptions
  - SDK examples

### 🛠️ Development *(Coming Soon)*

- **[DEVELOPMENT.md](./DEVELOPMENT.md)** - Local development guide:
  - Setting up local Supabase
  - Running tests
  - Debugging tips
  - Contribution guidelines
  - Code style and linting

---

## Quick Links by Role

### For Developers

1. Start with [../README.md](../README.md) for basic setup
2. Read [ARCHITECTURE.md](./ARCHITECTURE.md) to understand the system
3. Follow [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment
4. Reference [FEATURES.md](./FEATURES.md) for implementation details

### For DevOps/SRE

1. [DEPLOYMENT.md](./DEPLOYMENT.md) - Complete deployment checklist
2. [ARCHITECTURE.md](./ARCHITECTURE.md) - Infrastructure overview
3. [SECURITY.md](./SECURITY.md) *(coming soon)* - Security hardening

### For Product Managers

1. [FEATURES.md](./FEATURES.md) - All user-facing features explained
2. [../README.md](../README.md) - High-level product overview

### For Security Auditors

1. [SECURITY.md](./SECURITY.md) *(coming soon)* - Security architecture
2. [ARCHITECTURE.md](./ARCHITECTURE.md) - RLS and concurrency model
3. [FEATURES.md](./FEATURES.md) - MFA, audit logging, data protection

---

## Getting Help

- **Bug reports:** Open an issue on GitHub
- **Feature requests:** Create a feature request issue
- **Security issues:** Email security@yourdomain.com (do not open public issue)
- **General questions:** Check existing issues or start a discussion

---

## Documentation Status

| Document | Status | Last Updated |
|----------|--------|--------------|
| README.md (root) | ✅ Complete | 2026 |
| FEATURES.md | ✅ Complete | 2026 |
| DEPLOYMENT.md | ✅ Complete | 2026 |
| ARCHITECTURE.md | ✅ Complete | 2026 |
| SECURITY.md | ✅ Complete | 2026 |
| API.md | ✅ Complete | 2026 |
| DEVELOPMENT.md | 📋 Planned | - |

---

## Contributing to Documentation

Found an error or want to improve the docs?

1. Fork the repository
2. Edit the relevant `.md` file in `/docs`
3. Submit a pull request with a clear description
4. Follow markdown formatting guidelines:
   - Use ATX-style headers (`#`, `##`, etc.)
   - Code blocks with language hints
   - Tables for structured data
   - Internal links relative to docs folder

---

## Changelog

### 2026-01 - Initial Documentation Release
- Created FEATURES.md with all feature documentation
- Created DEPLOYMENT.md with complete deployment guide
- Created ARCHITECTURE.md with technical design
- Updated root README.md with feature highlights
- Created docs/README.md (this file)

---

**Last updated:** January 2026  
**Documentation version:** 1.0  
**Software version:** Corresponds to migration 034 (timezone-aware slot rejection)
