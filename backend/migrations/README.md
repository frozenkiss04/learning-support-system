# Migrations

Local first run can use `flask seed` (creates tables). For production schema
changes use Flask-Migrate: `flask db init`, `flask db migrate`, `flask db upgrade`.
