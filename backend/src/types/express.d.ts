declare global {
  namespace Express {
    interface Request {
      auth?: { userId: number; shopId: number };
    }
  }
}

export {};
