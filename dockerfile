FROM node:18 
LABEL author="hanje"
WORKDIR /usr/src/test
COPY package.json .
RUN npm install
COPY . .
RUN npm run --script build
CMD node dist/main.js
ENV PORT=3000
