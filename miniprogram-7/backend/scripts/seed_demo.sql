INSERT INTO papers (id, arxiv_id, title, authors, abstract, published_at, tags)
VALUES
  (
    '2cc95a16-4d2e-4d7d-bfda-98dfa7a2a001',
    '2501.00001',
    'SparseDiff: Efficient Diffusion with Structured Sparsity',
    '["A. Lin", "B. Zhang", "C. Wang"]'::jsonb,
    'We propose a sparse diffusion training recipe that reduces latency while preserving generation quality on vision-language tasks.',
    NOW() - INTERVAL '1 day',
    '["diffusion", "efficiency", "vision"]'::jsonb
  ),
  (
    '2cc95a16-4d2e-4d7d-bfda-98dfa7a2a002',
    '2501.00002',
    'RetrieverBench: A Practical Benchmark for RAG Pipelines',
    '["D. Liu", "E. Guo"]'::jsonb,
    'RetrieverBench evaluates retrieval quality, grounding faithfulness and end-to-end latency for real-world RAG systems.',
    NOW() - INTERVAL '2 day',
    '["rag", "benchmark", "nlp"]'::jsonb
  ),
  (
    '2cc95a16-4d2e-4d7d-bfda-98dfa7a2a003',
    '2501.00003',
    'GraphTune: Lightweight Adaptation for Graph Foundation Models',
    '["F. He", "G. Xu", "H. Song"]'::jsonb,
    'GraphTune introduces a parameter-efficient adaptation method that improves transfer on molecular and social graph tasks.',
    NOW() - INTERVAL '3 day',
    '["graph", "peft", "foundation-model"]'::jsonb
  )
ON CONFLICT (arxiv_id) DO NOTHING;

INSERT INTO paper_summaries (id, paper_id, summary_bg, summary_method, summary_contrib, model_name)
VALUES
  (
    '6f019d19-63fc-49ce-93fb-e4b9ac95b001',
    '2cc95a16-4d2e-4d7d-bfda-98dfa7a2a001',
    'Diffusion models often trade quality for inference speed.',
    'The paper applies structured sparsity during training and distillation.',
    'It reports better latency-quality balance on multimodal generation.',
    'gpt-4o-mini'
  ),
  (
    '6f019d19-63fc-49ce-93fb-e4b9ac95b002',
    '2cc95a16-4d2e-4d7d-bfda-98dfa7a2a002',
    'RAG systems lack unified practical evaluation standards.',
    'RetrieverBench combines retrieval, grounding and latency metrics.',
    'It enables reproducible ranking of production RAG pipelines.',
    'gpt-4o-mini'
  ),
  (
    '6f019d19-63fc-49ce-93fb-e4b9ac95b003',
    '2cc95a16-4d2e-4d7d-bfda-98dfa7a2a003',
    'Graph foundation models need efficient downstream adaptation.',
    'GraphTune adds small adapter modules with structural priors.',
    'It improves transfer while keeping trainable parameters low.',
    'gpt-4o-mini'
  )
ON CONFLICT (paper_id) DO NOTHING;
