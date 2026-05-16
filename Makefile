.PHONY: install format format-write lint typecheck test ci build clean help

help:
	@echo "Available targets:"
	@echo "  make install       Install npm dependencies"
	@echo "  make format        Check formatting (prettier --check)"
	@echo "  make format-write  Apply formatting (prettier --write)"
	@echo "  make lint          Run eslint"
	@echo "  make typecheck     Run tsc --noEmit"
	@echo "  make test          Run vitest"
	@echo "  make ci            Run all four checks (format, lint, typecheck, test)"
	@echo "  make build         Compile TypeScript to dist/"
	@echo "  make clean         Remove dist/ and coverage/"

install:
	npm install

format:
	npm run format

format-write:
	npm run format:write

lint:
	npm run lint

typecheck:
	npm run typecheck

test:
	npm run test

ci: format lint typecheck test

build:
	npm run build

clean:
	rm -rf dist coverage
