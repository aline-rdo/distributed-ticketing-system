import { v4 as uuidv4 } from "uuid";

const dummyIsAuthorized = true;

export const authMiddleware = (req, res, next) => {
  if (!dummyIsAuthorized) {
    return res.status(403).send("Unauthorized");
  }
  req.userId = uuidv4();
  next();
};
