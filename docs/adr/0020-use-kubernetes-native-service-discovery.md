---
status: accepted
---

# Use Kubernetes-native service discovery

Kubernetes `Service` and CoreDNS provide service discovery. Internal dependencies use `ClusterIP` DNS names, external HTTP uses Ingress or Gateway, and every workload defines Readiness and Liveness Probes; Consul and Eureka are outside v1.
