# Compra de ingressos com microsserviços gRPC

Projeto da disciplina **CIN0143 — Introdução a Sistemas Distribuídos e
Redes de Computadores**, do **Centro de Informática da Universidade Federal de
Pernambuco (CIn/UFPE)**. O projeto será usado para explorar diferentes formas de
comunicação entre serviços, como HTTP e gRPC, além de temas como falhas parciais,
orquestração com Kubernetes e escalabilidade horizontal.

A aplicação contém um frontend em Next.js e quatro serviços em Node.js. Nesta
entrega, o frontend continua fazendo a primeira chamada HTTP com Axios para o
serviço de pagamento, e os backends passam a se comunicar por gRPC em um fluxo
síncrono: cada etapa da compra aguarda a resposta da próxima antes de retornar.
A execução usa Docker Compose e os contratos gRPC ficam em `proto/`.

## Como executar

Com Docker e Docker Compose instalados, execute na raiz do repositório:

```sh
docker compose up --build
```

Acesse **http://localhost:3000** e clique em **Confirm & Pay**. Uma compra
normal leva aproximadamente nove segundos: o pagamento, a criação do ingresso
e o envio de e-mail simulam três segundos de processamento cada. Não são
necessárias credenciais nem serviços externos para executar a aplicação. A
construção inicial das imagens requer acesso à internet.

Para acompanhar os eventos registrados pelo serviço de analytics:

```sh
docker compose logs -f analytics-service
```

Para encerrar a aplicação e remover os contêineres:

```sh
docker compose down
```

## Componentes

| Componente | Responsabilidade | Endereço |
| --- | --- | --- |
| `frontend` | Exibe a página de compra e solicita o pagamento usando Axios | http://localhost:3000 |
| `payment-service` | Recebe a chamada HTTP externa, simula o pagamento e chama os demais serviços por gRPC | http://localhost:8000 |
| `tickets-service` | Gera o identificador do ingresso por gRPC e solicita o envio de e-mail | Porta interna gRPC 8001 |
| `email-service` | Simula o envio de e-mail por gRPC | Porta interna gRPC 8002 |
| `analytics-service` | Registra eventos gRPC de pagamento, ingresso e e-mail nos logs | Porta interna gRPC 8003 |

Cada componente possui seu próprio Dockerfile e arquivo de dependências
`package-lock.json`. O arquivo `compose.yaml`, na raiz, constrói as cinco imagens
e aguarda as verificações de saúde dos serviços dos quais cada componente
depende. Apenas o frontend e o serviço de pagamento expõem portas na máquina
hospedeira.

## Fluxo de requisições

1. O navegador envia `{ cart, total }` para `POST /payment-service` usando Axios.
2. O serviço de pagamento simula o processamento, informa um evento de pagamento
   ao analytics por gRPC e chama `TicketsService.CreateTicket` com
   `{ userId, cart }`.
3. O serviço de ingressos gera um UUID, informa um evento de criação de ingresso
   ao analytics por gRPC e chama `EmailService.SendEmail` com
   `{ userId, ticketId, ticketResult: "success" }`.
4. O serviço de e-mail simula o envio e informa um evento ao analytics por gRPC.
5. O serviço de pagamento retorna
   `{ paymentResult, ticketId, ticketResult, emailResult }` após a conclusão
   de toda a sequência da compra.

Os contratos usados nessa comunicação estão em `proto/checkout.proto` e
`proto/health.proto`. Os tipos de evento são `payments`, `tickets` e `emails`.
O analytics escreve os eventos na saída padrão (`stdout`), sem armazená-los em
um banco de dados. Os serviços internos disponibilizam health check gRPC pelo
contrato `grpc.health.v1.Health.Check`; o pagamento mantém `GET /health` para a
sonda HTTP do Compose.

Para testar uma compra sem usar o navegador:

```sh
curl --fail-with-body http://localhost:8000/payment-service \
  -H 'Content-Type: application/json' \
  -d '{"cart":[{"id":1,"name":"Friday","price":125}],"total":131.25}'
```

## Simulações e falhas

A autenticação sempre aceita a requisição e atribui um identificador aleatório
ao usuário. Os pagamentos não realizam cobranças, os e-mails não são enviados
e os dados não são persistidos. Os dados do cartão, o endereço de e-mail, o
cronômetro de reserva e o botão de remoção de ingressos no frontend são
exemplos visuais, sem funcionalidades reais de gerenciamento da compra.

Corpos de requisição inválidos retornam HTTP 400 no pagamento ou
`INVALID_ARGUMENT` nos RPCs internos. Uma falha no serviço de ingressos retorna
HTTP 502 para a chamada externa, e o frontend informa que a reserva falhou. Uma
falha no envio de e-mail é propagada pelo serviço de ingressos. Falhas retornadas
pelo analytics são registradas nos logs sem impedir a conclusão da compra.

As chamadas de aplicação não configuram timeouts ou deadlines. Os testes, as
sondas de saúde e o job de CI usam limites próprios apenas para evitar execuções
travadas. Os atrasos artificiais de três segundos nos arquivos `db.js` continuam
ativos e não devem ser removidos.

Não há novas tentativas automáticas, reversão de operações ou transações
distribuídas. Um pagamento pode ser concluído antes de ocorrer uma falha na
criação do ingresso ou no envio de e-mail. Repetir uma compra que falhou pode
repetir ações já concluídas. Essa versão básica torna visíveis os problemas de acoplamento síncrono entre serviços e os efeitos de falhas parciais.

## Testes e verificações

Os testes são executados automaticamente pelo GitHub Actions. Vocês podem
acompanhar os resultados na aba **Actions** do repositório para verificar se a
entrega atende aos requisitos avaliados pelos testes. Em caso de falha, consultem
os detalhes da execução para identificar o que precisa ser corrigido.

Para que a verificação automática das entregas funcione, as branches devem ter
**exatamente** os seguintes nomes:

- `entrega-1`
- `entrega-2`
- `entrega-3`

### Entrega 1 — gRPC

Consulte os [requisitos da entrega 1](requisitos/entrega-1.md). Os contratos,
os testes e o workflow estão disponíveis em `main`; esta branch contém a
implementação de referência usando gRPC.

A avaliação é automatizada. Os alunos devem preservar os testes e workflows
fornecidos; a equipe docente deve controlar a versão oficial da avaliação usada
para atribuir notas, independentemente dos arquivos enviados.

### Entrega 2 — Kubernetes

Consulte os [requisitos da entrega 2](requisitos/entrega-2.md). O setup existente
constrói as imagens e prepara os cinco componentes no cluster `cin0143`.

### Entrega 3 — autoscaling por memória

Consulte os [requisitos da entrega 3](requisitos/entrega-3.md). A atividade é
investigar o consumo de memória e configurar o Deployment e o HPA do pagamento.
Os demais componentes continuam com uma réplica. Esta branch contém a solução
de referência e a infraestrutura de avaliação fornecida aos alunos.

Com o cluster da Entrega 2 ativo:

```sh
python3 tests/entrega-2/setup_k8s.py
kubectl apply -f tests/entrega-3/metrics-server.yaml
kubectl -n kube-system rollout status deployment/metrics-server --timeout=180s
# Após criar ou alterar os manifests da Entrega 3:
kubectl apply -f k8s/
kubectl rollout status deployment/payment-service --timeout=120s
python3 tests/entrega-3/test_autoscaling.py
```

O teste executa compras dentro do cluster, acompanha o HPA e verifica o scale-up
sem reinícios ou `OOMKilled`.

## Licença

Este projeto está licenciado sob a [licença MIT](LICENSE).
