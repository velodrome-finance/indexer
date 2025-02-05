.PHONY: start
start:
	docker compose up --build -d
	docker stats envio-indexer

.PHONY: start-hydra
start-hydra:
	docker compose -f docker-compose-hydra.yaml up --build -d
	docker stats envio-indexer

.PHONY:  hard-stop
 hard-stop:
	docker compose down -v
	make remove-generated
.PHONY:  hard-stop-hydra
 hard-stop-hydra:
	docker compose -f docker-compose-hydra.yaml down -v
	make remove-generated

.PHONY: remove-generated
remove-generated:
	(rm -rf generated && rm -rf node_modules)

.PHONY: stop
stop:
	docker compose down

.PHONY: hard-restart
hard-restart:
	make hard-stop
	make start

.PHONY: hard-restart-hydra
hard-restart-hydra:
	make hard-stop-hydra
	make start-hydra

.PHONY: restart
restart:
	make stop
	make start

.PHONY: hard-start
hard-start:
	make remove-generated
	make start

.PHONY: indexer-logs
indexer-logs:
	docker logs envio-indexer -f

build-push-indexer:
	docker buildx build -t "${TAG}"  -f Dockerfile --platform ${ARCH} . --progress=plain; docker push "${TAG}"

