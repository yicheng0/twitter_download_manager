# Web Routes

The full web console currently registers routes from `backend.web.app` to preserve
legacy `import web_app` monkeypatch behavior used by the test suite.

New route groups should be added here by domain, for example `tasks.py`,
`accounts.py`, `schedules.py`, and `result_db.py`, once the corresponding
service functions have been extracted.
