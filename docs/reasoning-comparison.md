# OWL 2 DL vs OWL-RL: Reasoning Comparison

Ontosphere supports two reasoning backends: **Konclude** (full OWL 2 DL via SROIQ(D) tableau) and **N3 Rules** (OWL-RL subset, BGP-only). This page shows the difference on the `FamilyRoles` fixture — a small ontology that includes `owl:intersectionOf` and `owl:minCardinality` axioms, constructs the N3 BGP-only reasoner silently ignores.

N3 derives the reflexive `rdfs:subClassOf` closure and property domain/range inferences visible in any OWL-RL reasoner. Konclude additionally classifies the TBox via tableau: it recognises that `Father ≡ Male ⊓ Parent` and `Parent ≡ Person ⊓ ≥1 hasChild`, and derives the full subclass hierarchy — `Father ⊑ Male`, `Father ⊑ Parent`, and `Father ⊑ Person` — that the intersection axioms entail.

## Try it yourself

[Open comparison fixture in Ontosphere ↗](https://thhanke.github.io/ontosphere/?rdfUrl=https://raw.githubusercontent.com/ThHanke/ontosphere/refs/heads/main/public/owl2dl-comparison.ttl&ontologies=)

Switch the reasoner backend in *Settings → Reasoner Backend*, then click **Run reasoning** (▶) to see which edges each backend adds.

## N3 OWL-RL result

Reflexive subClassOf closure over declared classes; no new inter-class edges derived from the intersection axioms.

![N3 OWL-RL reasoning result](reasoning-comparison/01-n3-owlrl.svg)

## OWL 2 DL (Konclude) result

Full TBox classification: Konclude derives the subclass edges entailed by the `owl:equivalentClass / owl:intersectionOf` axioms.

![Konclude OWL 2 DL reasoning result](reasoning-comparison/02-konclude-owl2dl.svg)

Inferences Konclude adds that N3 does not:

- `Father rdfs:subClassOf Male` (Father ≡ Male ⊓ Parent → Father ⊑ Male)
- `Father rdfs:subClassOf Parent` (Father ≡ Male ⊓ Parent → Father ⊑ Parent)
- `Father rdfs:subClassOf Person` (Father ⊑ Parent, Parent ⊑ Person → Father ⊑ Person)
