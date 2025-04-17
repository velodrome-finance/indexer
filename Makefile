.PHONY: start
start:
	docker compose up --build -d
	docker stats envio-indexer

.PHONY:  hard-stop
 hard-stop:
	docker compose down -v
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
