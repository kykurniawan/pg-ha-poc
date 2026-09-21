create-network:
	docker network create pg-ha-net

up-node-1:
	docker-compose -f infrastructure/node-1/docker-compose.yml up -d

up-node-2:
	docker-compose -f infrastructure/node-2/docker-compose.yml up -d

up-node-3:
	docker-compose -f infrastructure/node-3/docker-compose.yml up -d

up-haproxy:
	docker-compose -f infrastructure/haproxy/docker-compose.yml up -d

down-node-1:
	docker-compose -f infrastructure/node-1/docker-compose.yml down

down-node-2:
	docker-compose -f infrastructure/node-2/docker-compose.yml down

down-node-3:
	docker-compose -f infrastructure/node-3/docker-compose.yml down

down-haproxy:
	docker-compose -f infrastructure/haproxy/docker-compose.yml down

up-all: up-node-1 up-node-2 up-node-3 up-haproxy

down-all: down-node-1 down-node-2 down-node-3 down-haproxy