
# Chat Backend – VortexHive AI Chatbot

This is the backend server for the VortexHive AI Chatbot, built using Node.js, Express, Sequelize ORM, and integrated with OpenAI APIs and PostgreSQL.

---

## 🚀 Features

- ✅ User authentication and registration
- ✅ Real-time chat via Socket.IO
- ✅ OpenAI-powered chatbot (RAG-enabled)
- ✅ Image upload and analysis
- ✅ AES-encrypted local storage support
- ✅ PostgreSQL with Sequelize ORM
- ✅ RESTful API for admin and clients
- ✅ JWT-based session management

---

## 📁 Project Structure

```
server/
├── config/              # Configuration files (e.g., DB, API keys)
├── controllers/         # Route logic
├── db/
│   └── models/          # Sequelize models
├── routes/              # Express route files
├── services/            # Business logic services
├── sockets/             # Socket.IO handlers
├── uploads/             # Uploaded images (if using local storage)
├── utils/               # Utility functions (encryption, logging, etc.)
├── .env                 # Environment variables (ignored in Git)
├── .gitignore
├── index.js             # App entry point
└── package.json
```

---

## 🔧 Setup Instructions

### 1. Clone the repository

```bash
git clone git@bitbucket.org:vortexhive/chat-backend.git
cd server
```

### 2. Install dependencies

```bash
npm install
```

### 3. Setup environment variables

Create a `.env` file (or use `.env.example` as a reference):

```bash
cp .env.example .env
```

Fill in variables like:
```env
PORT=5000
DATABASE_URL=postgres://user:password@localhost:5432/chatdb
JWT_SECRET=your_jwt_secret
OPENAI_API_KEY=your_openai_key
```

### 4. Run migrations (if using Sequelize)

```bash
npx sequelize db:migrate
```

### 5. Start the server

```bash
npm run dev     # For development with nodemon
npm start       # For production
```

---

## 📡 API Endpoints

| Method | Endpoint          | Description              |
|--------|-------------------|--------------------------|
| POST   | `/api/auth/login` | User login               |
| POST   | `/api/messages`   | Send message to chatbot  |
| GET    | `/api/users`      | List registered users    |
| ...    |                   | *(Custom endpoints here)*|

---

## 🧠 Technologies Used

- Node.js
- Express.js
- PostgreSQL
- Sequelize ORM
- Socket.IO
- OpenAI API
- JWT (jsonwebtoken)
- Multer (for file uploads)
- CryptoJS (AES encryption)

---

## 📦 Deployment

- Ensure `.env` is configured
- Use `pm2` or `docker` for production deployment
- Set up reverse proxy (e.g., NGINX) if needed

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch
3. Commit changes with clear messages
4. Open a pull request

---

## 📄 License

MIT License © VortexHive
