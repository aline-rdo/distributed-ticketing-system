import { v4 as uuidv4 } from "uuid";

export const createTicket = async (cart, userId) => {
  const id = uuidv4();

  const promise = new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve(id);
    }, 3000);
  });

  return promise;
};
