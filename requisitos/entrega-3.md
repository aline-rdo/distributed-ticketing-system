# Entrega 3 — Escalabilidade com HPA

## Objetivo

Configure escalabilidade horizontal para o `payment-service` da Entrega 2.
Quando compras concorrentes aumentarem o consumo de memória, o Kubernetes deve
criar novas réplicas do serviço por meio de um `HorizontalPodAutoscaler` (HPA).

O trabalho deve ser feito apenas nos manifests Kubernetes. Preserve o código
dos microsserviços, os contratos gRPC, os Services, as probes e o fluxo de
compra implementado nas entregas anteriores.

O `payment-service` deve começar com uma réplica e poderá escalar até três. Os
outros quatro componentes devem permanecer com uma única réplica e sem HPA.

## Restrições da atividade

Use um HPA `autoscaling/v2` para o `payment-service`, com mínimo de uma e máximo
de três réplicas. A decisão de escala deve ser baseada na memória média em valor
absoluto (`AverageValue`), e não em percentual de utilização (`Utilization`).
Não configure HPA para os demais serviços.

Escolha os valores de memória a partir das métricas observadas e do
comportamento exigido pela atividade. Preserve a configuração de CPU existente,
use quantidades de memória válidas e mantenha o request de memória menor ou
igual ao limit.

## Executar

Use Linux, Podman rootless, kind, kubectl, Python 3.11 ou superior e Node.js 24
ou superior. Na raiz do repositório, crie o cluster `cin0143` com a configuração
fornecida para esta entrega:

```bash
KIND_EXPERIMENTAL_PROVIDER=podman kind create cluster \
  --name cin0143 \
  --config tests/entrega-3/kind-config.yaml
```

Confirme que o contexto ativo é `kind-cin0143`. Em seguida, prepare a aplicação
da Entrega 2 e instale o Metrics Server:

```bash
python3 tests/entrega-2/setup_k8s.py
kubectl apply -f tests/entrega-3/metrics-server.yaml
kubectl -n kube-system rollout status deployment/metrics-server --timeout=180s
```

Depois de alterar os manifests, aplique a configuração e aguarde o pagamento
ficar disponível:

```bash
kubectl apply -f k8s/
kubectl rollout status deployment/payment-service --timeout=120s
```

Espere o Metrics Server começar a fornecer amostras antes de iniciar o
avaliador. Enquanto ele inicializa, `kubectl top pods` pode informar que as
métricas ainda não estão disponíveis; aguarde e execute o comando novamente.

Use os comandos abaixo para acompanhar o comportamento do cluster:

```bash
kubectl top pods
kubectl get hpa payment-service-hpa
kubectl describe hpa payment-service-hpa
kubectl get pods -l app=payment-service
```

## Testar e avaliar valores de escalabilidade

Execute o avaliador com o cluster preparado e os manifests aplicados:

```bash
python3 tests/entrega-3/test_autoscaling.py
```

O teste primeiro observa o serviço em repouso. Depois, envia compras
concorrentes, acompanha as métricas de memória e verifica se o HPA cria novas
réplicas sem interromper o fluxo de compra. Não execute outro gerador de carga
ao mesmo tempo.

Para investigar a configuração, altere um valor por vez, reaplique os manifests,
execute novamente o avaliador e compare:

- o consumo de memória com uma réplica em repouso;
- o consumo durante as compras concorrentes;
- o momento em que o HPA solicita uma nova réplica;
- a disponibilidade das novas réplicas;
- a ocorrência de reinícios ou `OOMKilled`.

Ao repetir o teste, recrie o HPA e reinicie o Deployment para não reutilizar o
estado da execução anterior:

```bash
kubectl delete hpa payment-service-hpa --ignore-not-found
kubectl apply -f k8s/payment-service.yaml
kubectl rollout restart deployment/payment-service
kubectl rollout status deployment/payment-service --timeout=120s
kubectl apply -f k8s/payment-service-hpa.yaml
python3 tests/entrega-3/test_autoscaling.py
```

Se o teste falhar, consulte a mensagem apresentada e use `kubectl top pods`,
`kubectl describe hpa` e `kubectl describe pod` para verificar o motivo antes de
alterar os valores.

### Nota para WSL com Podman rootless

Em WSL, falhas ao criar o cluster podem depender da integração entre Podman,
systemd e cgroups da sua distribuição. Isso não muda os comandos ou critérios
da entrega: verifique a configuração de Podman rootless e do systemd da sua
distribuição antes de aplicar ajustes específicos, pois eles variam entre
ambientes.

## Critérios de aceitação

A entrega será considerada aderente quando:

- A pipeline da branch `entrega-3` passar no GitHub Actions.
- O comando `python3 tests/entrega-3/test_autoscaling.py` finalizar com
  aprovação.
- O `payment-service` iniciar com uma réplica disponível e permanecer assim em
  repouso.
- O aumento do consumo de memória durante compras concorrentes fizer o
  `payment-service` escalar para pelo menos duas réplicas disponíveis.
- O `payment-service` não ultrapassar três réplicas.
- Nenhum Pod do `payment-service` reiniciar, desaparecer durante a avaliação ou
  terminar com `OOMKilled`.
- Todas as compras realizadas durante a carga terminarem com sucesso e gerarem
  ingressos válidos e distintos.
- `frontend`, `tickets-service`, `email-service` e `analytics-service`
  permanecerem com uma réplica e sem HPA.
- O fluxo completo de compra continuar usando gRPC entre os microsserviços.
- Os manifests entregues corresponderem aos recursos aplicados no cluster.

A suíte de avaliação valida os manifests, observa o consumo em repouso, aumenta
a concorrência das compras e acompanha o HPA, os Pods e as métricas de memória.
O scale-up precisa ser causado pela memória observada durante o teste e as novas
réplicas devem estar disponíveis antes da aprovação.

## Submissão e avaliação

Envie a implementação na branch `entrega-3`, com esse nome exato. O GitHub
Actions executa a avaliação automaticamente a cada push nessa branch.

A aprovação nos testes não substitui o cumprimento dos requisitos. Alterar ou
desativar testes e workflows, retornar resultados fixos ou tentar contornar a
avaliação reduzirá a nota final. A avaliação também considera a leitura dos
arquivos e código entregues e sua aderência ao enunciado.
