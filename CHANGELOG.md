# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v4.0.0] - 2026-08-01

### Added
- One-click launch scripts: `start.bat` (Windows) and `start.ps1` (PowerShell) to start backend + frontend together
- `backend/_smtp_test.py` — standalone utility to verify SMTP connectivity and credentials
- CHANGELOG.md for version tracking

### Changed
- **SMTP config security hardening**: `backend/app/core/config.py` no longer contains hardcoded Outlook credentials; defaults are now empty strings, requiring SMTP settings to be provided via environment variables. When credentials are empty, the system falls back to demo mode (email logs to `email_logs` table without actual sending)

### Fixed
- Security risk of committing live SMTP credentials to version control

---

## [v3.0.0] - (previous)

### Added
- Complete v3 rewrite: multi-session AI assistant with conversation management
- Graph module for competitive landscape visualization
- Organization management (multi-org support)
- Trackers module for monitoring competitor changes over time
- Email notification system (SMTP, attachments, manual send)
- JWT-based authentication with 7-day token expiry
- Dual-language README (Chinese / English)
