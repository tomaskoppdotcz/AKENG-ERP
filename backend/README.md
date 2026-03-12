# AKENG ERP v1 Backend (fixed scaffold)

Tato verze je opravena pro lokalni testovani a **standardne pouziva SQLite**,
aby sla spustit bez PostgreSQL.

## Spusteni

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Swagger:

```text
http://127.0.0.1:8000/docs
```

## Doporuceny test

1. `POST /seed/akeng-core`
2. `POST /seed/demo-planning-data`
3. `POST /planning/build-demo-schedules`
4. `GET /planning/machine-schedule?machine_id=1`
5. `GET /planning/operations?machine_id=1`

## Poznamka

Databaze je soubor `akeng_erp_v1.db` ve slozce `backend/`.
Kdyz chces cisty test, zastav backend a smaz:

```bash
rm akeng_erp_v1.db
```
