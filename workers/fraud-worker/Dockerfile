FROM node:lts-alpine
 
WORKDIR /app
 
COPY package*.json ./
RUN npm install --production
 
COPY . .
 
CMD ["node", "fraud-worker.js"]
 