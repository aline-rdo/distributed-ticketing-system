// ATENÇÃO, ALUNOS: não removam nem alterem este arquivo. Ele é fornecido pelos
// monitores para gerar o consumo fixo de memória usado na avaliação da Entrega 3.

const REQUEST_MEMORY_MB = 10;
const inFlightBuffers = new Set();

export function retainCheckoutMemory(req, res, next) {
  if (req.path === "/payment-service" && req.method === "POST" && REQUEST_MEMORY_MB > 0) {
    const buffer = Buffer.alloc(REQUEST_MEMORY_MB * 1024 * 1024);
    buffer.fill(1); // Força a alocação das páginas físicas de memória no Linux.
    inFlightBuffers.add(buffer);

    const cleanup = () => {
      inFlightBuffers.delete(buffer);
      res.removeListener("finish", cleanup);
      res.removeListener("close", cleanup);
    };

    res.on("finish", cleanup);
    res.on("close", cleanup);
  }

  next();
}
