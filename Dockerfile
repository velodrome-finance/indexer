
ARG ARCH=
FROM ${ARCH}node:20-bookworm
ARG TARGETARCH
WORKDIR /app/base-template

RUN npm install -g npm@latest
COPY . .

ENV PNPM_HOME /usr/local/binp
RUN npm install --global pnpm@9.10.0

CMD ./envio-entrypoint.sh
