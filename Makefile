.PHONY: up down dev build logs siyuan-logs hugo-logs restart clean reset

.env:
	cp .env.example .env
	@echo ".env edit SIYUAN_ACCESS_AUTH_CODE before launching"

up: .env
	docker compose up -d --build
	@echo ""
	@echo "SiYuan : http://localhost:$$(grep SIYUAN_PORT .env | cut -d= -f2 || echo 6806)"
	@echo "Hugo   : http://localhost:$$(grep HUGO_PORT .env | cut -d= -f2 || echo 1313)"

down:
	docker compose down

dev:
	docker compose build siyuan
	docker compose up -d siyuan

build:
	docker compose build --no-cache
	docker compose up -d

logs:
	docker compose logs -f

siyuan-logs:
	docker compose logs -f siyuan

hugo-logs:
	docker compose logs -f hugo

restart:
	docker compose restart $(s)

clean:
	docker compose down --rmi local

reset:
	@echo "⚠️ This will delete ALL SiYuan and Hugo data."
	@read -p "Confirm? [y/N] " ans && [ "$$ans" = "y" ]
	docker compose down -v --rmi local
