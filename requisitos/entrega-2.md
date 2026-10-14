# Entrega 2 - Kubernetes

## Objetivo

Execute a aplicacao da Entrega 1 em um cluster Kubernetes local criado com
kind e Podman rootless. A comunicacao entre microsservicos continua em gRPC;
o frontend continua usando HTTP para acessar o `payment-service`.

## Softwares obrigatorios

- Linux com suporte a containers rootless
- Podman configurado em modo rootless
- kind configurado para usar Podman
- kubectl compativel com o cluster kind
- Python 3.11 ou superior
- Node.js 24 ou superior
- Acesso a internet para o primeiro build das imagens

O cluster kind deve obrigatoriamente se chamar `cin0143`. Crie-o com Podman
rootless antes de preparar a aplicacao:

```bash
KIND_EXPERIMENTAL_PROVIDER=podman kind create cluster --name cin0143
```

O contexto ativo esperado pelo projeto e `kind-cin0143`. O setup encerra com
erro quando outro contexto ou nome de cluster estiver selecionado.

## Componentes e fluxo

| Componente | Funcao | Porta |
| --- | --- | --- |
| `frontend` | Interface de compra e cliente HTTP | 3000 |
| `payment-service` | Endpoint HTTP e coordenacao da compra | 8000 |
| `tickets-service` | Criacao de ingressos por gRPC | 8001 |
| `email-service` | Envio de e-mail por gRPC | 8002 |
| `analytics-service` | Registro de eventos por gRPC | 8003 |

```text
Browser --HTTP--> Frontend --HTTP--> Payment Service
                                        |--gRPC--> Tickets Service --gRPC--> Email Service
                                        |--gRPC--> Analytics Service
Tickets Service ------------------------|--gRPC--> Analytics Service
Email Service --------------------------|--gRPC--> Analytics Service
```

## Kubernetes

- Mantenha um `Deployment` e um `Service` para cada componente em `k8s/`.
- Todo Deployment deve usar `replicas: 1`. Nao implemente autoscaling.
- Todos os Services devem ser `ClusterIP`. Use os nomes dos Services, nunca
  IPs de Pods, para a comunicacao interna.
- Os enderecos internos obrigatorios sao `tickets-service:8001`,
  `email-service:8002` e `analytics-service:8003`.
- Todo container deve declarar os seguintes recursos:

```yaml
resources:
  requests:
    cpu: "200m"
    memory: "64Mi"
  limits:
    cpu: "300m"
    memory: "256Mi"
```

## Configuracao obrigatoria

| Deployment | Variaveis de ambiente |
| --- | --- |
| `payment-service` | `PORT=8000`, `FRONTEND_ORIGIN=http://localhost:3000`, `TICKETS_SERVICE_ADDRESS=tickets-service:8001`, `ANALYTICS_SERVICE_ADDRESS=analytics-service:8003` |
| `tickets-service` | `PORT=8001`, `EMAIL_SERVICE_ADDRESS=email-service:8002`, `ANALYTICS_SERVICE_ADDRESS=analytics-service:8003` |
| `email-service` | `PORT=8002`, `ANALYTICS_SERVICE_ADDRESS=analytics-service:8003` |
| `analytics-service` | `PORT=8003` |

Configure probes Kubernetes com os checks existentes:

- `payment-service`: `GET /health`
- `frontend`: `GET /`
- Servicos gRPC: `grpc.health.v1.Health.Check`

Construa as imagens com Podman usando nomes no formato obrigatorio:

```text
docker.io/cin0143/<componente>:entrega-2
```

Exemplo:

```text
docker.io/cin0143/analytics-service:entrega-2
```

O mesmo nome completo deve ser utilizado no build, na exportacao e no
respectivo Deployment. Todos os containers devem usar:

```yaml
imagePullPolicy: IfNotPresent
```

O setup carrega as imagens locais no runtime dos nodes do kind antes de
aplicar os manifests. Com `IfNotPresent`, o Kubernetes utiliza essa imagem
local quando ela estiver disponivel e somente tenta busca-la em um registry
quando ela estiver ausente. A padronizacao do nome evita que o runtime trate a
imagem carregada e a imagem declarada no Deployment como referencias distintas.

## Executar

Na raiz do repositorio, com o cluster `cin0143` ativo e o contexto
`kind-cin0143` selecionado:

```bash
python3 tests/entrega-2/setup_k8s.py
```

O comando verifica as ferramentas e o cluster, constroi e exporta as imagens,
carrega-as no kind, aplica `k8s/`, aguarda os cinco Deployments e mostra o
estado de Deployments, Pods e Services.

Para expor a aplicacao na maquina local:

```bash
python3 tests/entrega-2/port_forward.py
```

- Frontend: `http://localhost:3000`
- Payment Service: `http://localhost:8000`

Os demais Services ficam internos ao cluster. Use `Ctrl+C` para encerrar os
port-forwards.

## Estrutura esperada

```text
k8s/
├── analytics-service.yaml
├── email-service.yaml
├── frontend.yaml
├── payment-service.yaml
└── tickets-service.yaml

tests/entrega-2/
├── port_forward.py
└── setup_k8s.py
```

## Critérios de aceitação

A entrega será considerada aderente quando:

- A pipeline da branch `entrega-2` passar no GitHub Actions.
- Os cinco componentes executarem no Kubernetes com uma réplica disponível por
  Deployment e os Pods em estado `Running`.
- Os Services e EndpointSlices permitirem a comunicação interna pelos nomes
  dos Services, sem endereços de Pods fixados nos manifests.
- Todos os containers declararem requests e limits de CPU e memória conforme o
  enunciado.
- O fluxo completo de compra funcionar pelo frontend e utilizar gRPC entre
  `payment-service`, `tickets-service`, `email-service` e
  `analytics-service`.
- As imagens usadas pelos Deployments corresponderem às imagens construídas e
  carregadas no cluster pelo script de preparação.
- As probes confirmarem a disponibilidade dos serviços HTTP e gRPC.
- Nenhum componente possuir configuração de autoscaling nesta entrega.

A avaliação automatizada verifica os scripts de preparação, cria o cluster
`cin0143`, constrói e carrega as imagens, aplica os manifests e aguarda a
disponibilidade dos cinco Deployments. A aderência do fluxo de compra e da
comunicação gRPC também faz parte dos critérios da entrega.

## Submissão e avaliação

Envie a implementação na branch `entrega-2`, com esse nome exato. O GitHub
Actions executa a avaliação automaticamente a cada push nessa branch.

A aprovação na pipeline não substitui o cumprimento dos requisitos. Alterar ou
desativar testes e workflows, retornar resultados fixos ou tentar contornar a
avaliação reduzirá a nota final. A avaliação também considera a leitura dos
arquivos e código entregues e sua aderência ao enunciado.
