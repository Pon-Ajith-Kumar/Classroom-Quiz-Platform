# Offline Classroom Quiz Platform

A real-time classroom quiz system designed for:

- **1 teacher laptop** (runs server + teacher dashboard)
- **up to 9 team phones** (participants)
- all devices connected to the **same mobile hotspot**
- fully offline local-network operation

## Hotspot Setup (Your exact scenario)

1. Turn on hotspot on one mobile phone (supports up to 10 devices).
2. Connect:
   - teacher laptop (server machine)
   - 9 team mobile phones
3. On teacher laptop, run:

```bash
npm install
node server.js
```

4. Find teacher laptop hotspot IP (for example `192.168.43.120`).
5. Teams open in browser:

- `http://<laptop-ip>:3000`

6. Teacher opens:

- `http://<laptop-ip>:3000/teacher`

> The app is coded for **maximum 9 teams** and listens on `0.0.0.0:3000`, so hotspot-connected devices can access it.

## Local testing on same machine

- Team page: `http://localhost:3000`
- Teacher page: `http://localhost:3000/teacher`
