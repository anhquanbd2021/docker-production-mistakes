FROM node:latest
WORKDIR /app
COPY . .
COPY .env .env
RUN apt-get update && apt-get install -y gcc make
RUN npm install
RUN rm .env
ENV DB_PASSWORD=prod-secret-123
CMD cron & node src/index.js
