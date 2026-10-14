export const sendEmail = async (orderId, userId, emailResult) => {
  const promise = new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve("success");
      // reject(new Error("Email failed"))
    }, 3000);
  });

  return promise;
};
