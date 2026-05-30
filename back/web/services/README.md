# Web Services

Business logic for the full web console belongs here as it is extracted from
`back.web.app`.

Keep modules domain-oriented:

- `accounts.py` for account validation, login queue, browser login, and warmup.
- `resources.py` for account/proxy selection, cooldown, and capacity policy.
- `tasks.py` for task config, queueing, execution, indexing, and result files.
- `schedules.py` for scheduled task and monitor behavior.
- `result_db.py` for external result database sync and heatmaps.
