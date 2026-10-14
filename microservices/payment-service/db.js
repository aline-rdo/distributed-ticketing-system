export const pay = async (cart, total, userId) => {
  const promise = new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve("success");
    }, 3000);
  });

  return promise;
};
