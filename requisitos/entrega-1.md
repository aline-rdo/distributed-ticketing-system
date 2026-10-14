# Entrega 1 — comunicação entre microsserviços com gRPC

## Objetivo

Esta entrega faz parte da disciplina **CIN0143 — Introdução a Sistemas
Distribuídos e Redes de Computadores**, do **Centro de Informática da UFPE
(CIn/UFPE)**. O objetivo é substituir a comunicação HTTP entre os backends por
chamadas gRPC síncronas, mantendo o mesmo domínio da aplicação de compra de
ingressos.

A versão em `main` é a base HTTP. A branch `entrega-1` deve conter a solução com
gRPC. O frontend continua fazendo a primeira requisição HTTP para o serviço de
pagamento; a mudança desta entrega acontece nas chamadas entre os serviços de
backend.

## Preparação

Comece a partir da branch `main` atualizada e crie a branch da entrega com o
nome exato:

```sh
git switch main
git pull
git switch -c entrega-1
```

Instale as dependências dos serviços e dos testes:

```sh
npm ci --prefix tests/entrega-1
for service in analytics-service email-service payment-service tickets-service; do
  npm ci --prefix "microservices/$service"
done
```

Execute a avaliação da entrega:

```sh
npm test --prefix tests/entrega-1
```

Os testes de `tests/entrega-1` falham na base HTTP. A implementação deve fazer
esses testes passarem usando gRPC de verdade, sem alterar a avaliação para
aceitar HTTP.

## Contratos gRPC

Os contratos estão em `proto/checkout.proto` e `proto/health.proto`. A
implementação deve usar esses arquivos como fonte do contrato entre os serviços.
Não substitua os modelos por strings JSON dentro de mensagens genéricas.

RPCs obrigatórios:

- `TicketsService.CreateTicket`
- `EmailService.SendEmail`
- `AnalyticsService.RecordEvent`
- `grpc.health.v1.Health.Check`

Campos principais que devem ser preservados:

- Carrinho: `id`, `name`, `price`, `image`, `date`, `category`, `location`,
  `description`.
- Pagamento: `userId`, `cart`, `total`, `paymentResult`.
- Ingresso: `userId`, `ticketId`, `ticketResult`.
- E-mail: `userId`, `ticketId`, `emailResult`.

## Endereços e portas

Mantenha o fluxo externo da aplicação:

- `frontend` acessa `payment-service` por HTTP.
- `payment-service` expõe `POST /payment-service` para o frontend.
- Os serviços internos de backend usam gRPC para chamadas de negócio.

Use variáveis de ambiente com endereços gRPC no formato `host:porta`, por
exemplo:

- `TICKETS_SERVICE_ADDRESS`
- `EMAIL_SERVICE_ADDRESS`
- `ANALYTICS_SERVICE_ADDRESS`

As portas usadas pela aplicação continuam as mesmas:

- `payment-service`: `8000`
- `tickets-service`: `8001`
- `email-service`: `8002`
- `analytics-service`: `8003`

Os serviços gRPC devem implementar `grpc.health.v1.Health.Check` para que os
testes e o Docker Compose consigam verificar prontidão.

## Chamadas permitidas

O frontend pode continuar usando Axios para a primeira chamada HTTP ao serviço
de pagamento. Entre os backends, use gRPC.

Nesta entrega, não mantenha endpoints HTTP internos de negócio como alternativa
para aprovação. A avaliação verifica conexões gRPC reais, payloads recebidos por
pares controlados e ausência de deadlines configurados nas chamadas da
aplicação.

## Atrasos simulados

Os arquivos `db.js` simulam três segundos de processamento. Esses atrasos são
parte permanente do projeto e serão usados em etapas futuras.

Não remova, reduza ou ignore os atrasos dos `db.js` para acelerar a execução dos
testes. A avaliação espera que operações válidas continuem levando pelo menos o
tempo correspondente ao processamento simulado.

## Timeouts, deadlines e falhas

Remova timeouts de aplicação das chamadas entre serviços e da chamada Axios do
frontend. Nas chamadas gRPC da aplicação, não configure deadlines.

Os testes e as verificações de saúde podem usar limites de tempo para evitar
execuções travadas. Esses limites pertencem à avaliação e à infraestrutura, não
ao comportamento de negócio.

Regras de erro esperadas:

- Requisições inválidas devem falhar antes do processamento simulado.
- Carrinho vazio, preço negativo, preço ausente, total inválido, `userId` vazio,
  `ticketId` vazio e eventos incompatíveis devem ser rejeitados.
- Se o serviço de ingressos falhar, o pagamento deve retornar HTTP 502.
- Se o serviço de e-mail falhar, o serviço de ingressos deve propagar a falha.
- Se o analytics retornar erro, a falha deve ser registrada, mas não deve
  impedir a compra, a criação do ingresso ou o envio de e-mail.
- Se o analytics não responder e não houver deadline de aplicação, o fluxo pode
  ficar aguardando. Isso é esperado nesta entrega.

Não implemente novas tentativas automáticas, rollback ou transações
distribuídas.

## Docker Compose e limites

A aplicação deve continuar rodando com um único `docker compose up --build` na
raiz do repositório. Todos os componentes devem manter Dockerfile próprio e
devem preservar os limites de recursos já definidos:

```yaml
resources:
  requests:
    cpu: 200m
    memory: 64Mi
  limits:
    cpu: 300m
    memory: 256Mi
```

## Critérios de aceitação

A entrega será considerada aderente quando:

- `npm test --prefix tests/entrega-1` passar na branch `entrega-1`.
- O fluxo completo de compra retornar `paymentResult`, `ticketId`,
  `ticketResult` e `emailResult` corretos.
- O carrinho e os campos de apresentação forem preservados nos RPCs.
- Os eventos de analytics registrarem valores reais de pagamentos, ingressos e
  e-mails.
- Os testes provarem que as chamadas internas usam gRPC e não HTTP.
- As chamadas da aplicação não configurarem deadlines.
- Os atrasos de três segundos dos `db.js` permanecerem ativos.
- O Docker Compose subir frontend, payment, tickets, email e analytics em uma
  única execução.

A suíte de avaliação cobre, de forma explícita, os seguintes cenários:

- O avaliador consegue trocar mensagens Protobuf com pares gRPC controlados.
- Duas compras completas preservam resultados, valores reais, eventos de
  analytics e os três atrasos simulados da cadeia.
- O pagamento envia carrinho completo, total e mesmo `userId` para os pares gRPC
  de ingressos e analytics, sem configurar deadline de aplicação.
- Entradas HTTP inválidas no pagamento são rejeitadas com HTTP 400 antes de
  qualquer atraso ou chamada de saída.
- Uma falha `UNAVAILABLE` do analytics não impede o pagamento, mas uma falha
  `UNAVAILABLE` do serviço de ingressos vira HTTP 502.
- O serviço de ingressos valida entradas inválidas, preserva UUID, `userId`,
  carrinho, resultado de e-mail e evento de analytics, e propaga falha do serviço
  de e-mail.
- O serviço de e-mail valida entradas inválidas, envia ao analytics os valores
  reais de `userId`, `ticketId` e `emailResult`, e tolera falha do analytics.
- O analytics aceita os três tipos de evento, registra os valores recebidos nos
  logs e rejeita eventos desconhecidos, incompletos ou incompatíveis com o
  `oneof`.
- As operações individuais válidas respeitam o atraso mínimo de 2,9 segundos, e
  a cadeia completa respeita o atraso mínimo de 8,9 segundos.

## Submissão e avaliação

Envie a implementação na branch `entrega-1`, com esse nome exato. O GitHub
Actions executa a avaliação automaticamente a cada push nessa branch.

A aprovação nos testes não substitui o cumprimento dos requisitos. Alterar ou
desativar testes e workflows, retornar resultados fixos ou tentar contornar a
avaliação reduzirá a nota final. A avaliação também considera a leitura dos
arquivos e código entregues e sua aderência ao enunciado.
