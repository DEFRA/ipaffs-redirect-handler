ARG BASE_VERSION=latest-24
FROM defradigital/node:$BASE_VERSION AS production

USER root

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY service /usr/src/app

RUN npm ci --only=production --ignore-scripts && \
    chown node /usr/src/app

USER node

EXPOSE 8000

ENV npm_config_maxsockets 128

CMD [ "npm", "start" ]
