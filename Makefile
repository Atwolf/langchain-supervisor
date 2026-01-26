.PHONY: all start stop db db-stop db-logs website chainlit clean help

# Default target - start all services
all: start

# Start all services (db, website, chainlit)
start: db
	@echo "Starting website server on http://localhost:3000..."
	@cd website && ${PWD}/.venv/bin/python -m http.server 3000 &
	@sleep 1
	@echo "Starting Chainlit app on http://localhost:8000..."
	@uv run chainlit run chainlit_app.py

# Stop all services
stop: db-stop
	@echo "Stopping website server..."
	@pkill -f "python -m http.server 3000" 2>/dev/null || true
	@echo "All services stopped."

# Database commands
db:
	@echo "Starting PostgreSQL database..."
	@docker compose -f datalayer/database/docker-compose.yml up -d
	@echo "Waiting for database to be ready..."
	@sleep 3
	@docker compose -f datalayer/database/docker-compose.yml exec -T postgres pg_isready -U chainlit -d chainlit_db || (echo "Database not ready, waiting..." && sleep 5)
	@echo "Database is ready!"

db-stop:
	@echo "Stopping PostgreSQL database..."
	@docker compose -f datalayer/database/docker-compose.yml down

db-logs:
	@docker compose -f datalayer/database/docker-compose.yml logs -f postgres

db-shell:
	@docker compose -f datalayer/database/docker-compose.yml exec postgres psql -U chainlit -d chainlit_db

db-reset:
	@echo "Resetting database (removing all data)..."
	@docker compose -f datalayer/database/docker-compose.yml down -v
	@echo "Database reset complete. Run 'make db' to start fresh."

# Individual services
website:
	@echo "Starting website server on http://localhost:3000..."
	@cd website && python -m http.server 3000

chainlit: db
	@echo "Starting Chainlit app on http://localhost:8000..."
	@uv run chainlit run chainlit_app.py

# Development helpers
install:
	@echo "Installing dependencies..."
	@uv sync

lint:
	@echo "Running linter..."
	@uv run pylint src/ chainlit_app.py

format:
	@echo "Formatting code..."
	@uv run black src/ chainlit_app.py

test:
	@echo "Running tests..."
	@uv run pytest

# Cleanup
clean: stop
	@echo "Cleaning up..."
	@find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name "*.pyc" -delete 2>/dev/null || true

# Help
help:
	@echo "Available commands:"
	@echo "  make start      - Start all services (db, website, chainlit)"
	@echo "  make stop       - Stop all services"
	@echo "  make db         - Start PostgreSQL database"
	@echo "  make db-stop    - Stop PostgreSQL database"
	@echo "  make db-logs    - View database logs"
	@echo "  make db-shell   - Open psql shell to database"
	@echo "  make db-reset   - Reset database (removes all data)"
	@echo "  make website    - Start website server only"
	@echo "  make chainlit   - Start Chainlit app only (starts db first)"
	@echo "  make install    - Install dependencies"
	@echo "  make lint       - Run linter"
	@echo "  make format     - Format code"
	@echo "  make test       - Run tests"
	@echo "  make clean      - Stop services and clean cache files"
	@echo "  make help       - Show this help message"
