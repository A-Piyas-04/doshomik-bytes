// Starter content for local testing: a few well-known papers with Learn first topics,
// learn items, a course, practice questions and one roadmap per field.

export const fields = [
  { name: 'Machine Learning', description: 'Core methods for learning from data.', position: 1 },
  { name: 'Deep Learning', description: 'Training many-layered neural networks.', position: 2 },
  { name: 'Computer Vision', description: 'Models that understand images and video.', position: 3 },
  { name: 'Large Language Models', description: 'Models that read and generate text.', position: 6 },
];

export const topics = [
  { name: 'Gradient descent', summary: "Repeatedly nudges a model's parameters in the direction that lowers the loss." },
  { name: 'Backpropagation', summary: 'The chain rule applied layer by layer to find how much each weight changed the loss.' },
  { name: 'Neural networks', summary: 'Layers of weighted sums and non-linear functions, trained to map inputs to outputs.' },
  { name: 'Convolutional neural networks', summary: 'Networks that slide small learned filters over an image to find local patterns.' },
  { name: 'Word embeddings', summary: 'Dense vectors that place words with similar meanings close together.' },
  { name: 'Attention mechanism', summary: 'Weighs every input position by how relevant it is to the one being processed.' },
  { name: 'Softmax', summary: 'Turns a list of scores into probabilities that sum to one.' },
  { name: 'Transformers', summary: 'Sequence models built from stacked self-attention and feed-forward layers, without recurrence.' },
];

export const learnItems = [
  {
    topic: 'Gradient descent',
    title: 'Gradient descent in one minute',
    body: 'Picture the loss as a hilly landscape. The gradient points uphill, so each step moves the parameters a little downhill: new weight = old weight − learning rate × gradient. Too large a learning rate overshoots; too small crawls.',
  },
  {
    topic: 'Backpropagation',
    title: 'How backpropagation works',
    body: 'Run the network forward and measure the loss. Then walk backwards through the layers, using the chain rule to pass the gradient from each layer to the one before it. Every weight ends up with its own gradient for gradient descent to use.',
  },
  {
    topic: 'Softmax',
    title: 'Softmax, step by step',
    body: 'Take each score, raise e to that power, and divide by the sum of all of them. Larger scores get larger shares, every output is between 0 and 1, and the outputs add up to 1.',
  },
  {
    topic: 'Attention mechanism',
    title: 'What attention does',
    body: 'Each token makes a query and compares it with every token’s key. Softmax turns those similarity scores into weights, and the output is the weighted sum of the tokens’ values. So each token gathers information from the tokens that matter most to it.',
  },
];

export const course = {
  title: 'Foundations for reading Transformer papers',
  description: 'Four short lessons that cover what the Transformer paper assumes you know.',
  items: ['Gradient descent in one minute', 'How backpropagation works', 'Softmax, step by step', 'What attention does'],
};

export const externalCourse = {
  title: 'Practical Deep Learning for Coders (fast.ai)',
  description: 'A free, hands-on course that starts with working models and explains the theory along the way.',
  external_url: 'https://course.fast.ai/',
};

export const questions = [
  {
    topic: 'Gradient descent',
    kind: 'mcq' as const,
    prompt: 'In gradient descent, which way are the parameters moved?',
    options: ['Along the gradient', 'Against the gradient', 'In a random direction', 'Towards zero'],
    answer: 'Against the gradient',
    explanation: 'The gradient points towards the steepest increase in loss, so stepping the opposite way reduces it.',
  },
  {
    topic: 'Backpropagation',
    kind: 'short' as const,
    prompt: 'Which rule from calculus does backpropagation apply?',
    answer: 'Chain rule',
    explanation: 'The gradient of each layer is the product of the local derivative and the gradient from the layer after it.',
  },
  {
    topic: 'Softmax',
    kind: 'short' as const,
    prompt: 'What do the outputs of a softmax always add up to?',
    answer: '1',
    explanation: 'Each output is its exponential divided by the sum of all exponentials, so together they sum to one.',
  },
  {
    topic: 'Attention mechanism',
    kind: 'mcq' as const,
    prompt: 'In scaled dot-product attention, what are the scores divided by?',
    options: ['The number of heads', 'The square root of the key dimension', 'The sequence length', 'The vocabulary size'],
    answer: 'The square root of the key dimension',
    explanation: 'Dividing by √d_k keeps the dot products from growing so large that softmax saturates.',
  },
];

export const papers = [
  {
    field: 'Machine Learning',
    title: 'Adam: A Method for Stochastic Optimization',
    authors: 'Diederik P. Kingma, Jimmy Ba',
    year: 2014,
    paper_url: 'https://arxiv.org/abs/1412.6980',
    arxiv_id: '1412.6980',
    research_questions: [
      'Can one optimiser give every parameter its own step size using only first-order gradients?',
      'Can it stay efficient on large, noisy and sparse problems?',
    ],
    main_idea:
      "Adam keeps running averages of each parameter's gradient and squared gradient, corrects their bias towards zero early in training, and uses their ratio to set a separate step size for every parameter.",
    data_source: 'Logistic regression on MNIST and IMDB, multilayer networks on MNIST, and convolutional networks on CIFAR-10.',
    method_steps: [
      'Compute the gradient of the loss on a mini-batch.',
      'Update a moving average of the gradient (first moment).',
      'Update a moving average of the squared gradient (second moment).',
      'Correct both averages for their bias towards zero in early steps.',
      'Move each parameter by the corrected first moment divided by the square root of the corrected second moment.',
    ],
    results:
      'Adam converged as fast as or faster than SGD with momentum, AdaGrad and RMSProp on the tested models, with little tuning of its defaults.',
    limitations:
      'The convergence proof assumes convex problems. Later work showed Adam can fail to converge in some cases and may generalise worse than SGD on some tasks.',
    evaluation: 'Training loss curves against other optimisers on the same models and data.',
    prerequisites: ['Gradient descent'],
  },
  {
    field: 'Computer Vision',
    title: 'Deep Residual Learning for Image Recognition',
    authors: 'Kaiming He, Xiangyu Zhang, Shaoqing Ren, Jian Sun',
    year: 2015,
    paper_url: 'https://arxiv.org/abs/1512.03385',
    arxiv_id: '1512.03385',
    research_questions: [
      'Why do deeper plain networks reach worse training error than shallower ones?',
      'Can very deep networks be trained by learning residual functions instead?',
    ],
    main_idea:
      'Each block learns only the difference (residual) from its input, and a shortcut connection adds the input back. This made networks with over 100 layers trainable.',
    data_source: 'ImageNet (ILSVRC 2012) classification, CIFAR-10, and COCO for object detection.',
    method_steps: [
      'Group layers into blocks of two or three convolutions.',
      "Add an identity shortcut that carries each block's input to its output.",
      'Add the block output and the shortcut, then apply the activation.',
      'Stack many blocks, using bottleneck blocks for the 50, 101 and 152-layer models.',
    ],
    results:
      'An ensemble of residual networks reached 3.57% top-5 error on ImageNet and won ILSVRC 2015 classification. Deeper residual networks trained better than plain networks of the same depth.',
    limitations:
      'A 1202-layer network on CIFAR-10 did worse than a 110-layer one, likely from overfitting. Why residuals help is shown mostly through experiments.',
    evaluation: 'Top-1 and top-5 error on ImageNet and error on CIFAR-10, compared with plain networks and earlier models.',
    prerequisites: ['Convolutional neural networks', 'Backpropagation'],
  },
  {
    field: 'Large Language Models',
    title: 'Efficient Estimation of Word Representations in Vector Space',
    authors: 'Tomas Mikolov, Kai Chen, Greg Corrado, Jeffrey Dean',
    year: 2013,
    paper_url: 'https://arxiv.org/abs/1301.3781',
    arxiv_id: '1301.3781',
    research_questions: [
      'Can high-quality word vectors be learned cheaply from billions of words?',
      'Do simple models capture syntactic and semantic relationships between words?',
    ],
    main_idea:
      'Two shallow models, CBOW (predict a word from its neighbours) and Skip-gram (predict the neighbours from a word), learn word vectors much faster than earlier neural language models. The vectors capture relationships such as king − man + woman ≈ queen.',
    data_source: 'A Google News corpus of about 6 billion tokens, and a word-analogy test set built by the authors.',
    method_steps: [
      'Slide a window over the text.',
      'CBOW: combine the context word vectors and predict the centre word.',
      'Skip-gram: use the centre word to predict each context word.',
      'Use hierarchical softmax to keep training cheap on a large vocabulary.',
      'Test the vectors on analogy questions using vector arithmetic.',
    ],
    results:
      'The models trained in hours rather than weeks and beat earlier neural models on the analogy test. Skip-gram did best on semantic questions.',
    limitations: 'One vector per word, so different meanings of a word are merged. Word order is ignored beyond the window.',
    evaluation: 'Accuracy on semantic and syntactic analogy questions, plus training time.',
    prerequisites: ['Word embeddings', 'Neural networks'],
  },
  {
    field: 'Large Language Models',
    title: 'Attention Is All You Need',
    authors: 'Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N. Gomez, Łukasz Kaiser, Illia Polosukhin',
    year: 2017,
    paper_url: 'https://arxiv.org/abs/1706.03762',
    arxiv_id: '1706.03762',
    research_questions: [
      'Can a sequence model rely on attention alone, without recurrence or convolution?',
      'Does that train faster and translate better?',
    ],
    main_idea:
      'The Transformer replaces recurrent layers with self-attention, so every position looks at every other position at once. Stacked multi-head attention and feed-forward layers, plus positional encodings, form an encoder and a decoder.',
    data_source: 'WMT 2014 English–German (about 4.5 million sentence pairs) and English–French (about 36 million sentence pairs).',
    method_steps: [
      'Embed the input tokens and add positional encodings.',
      'In each encoder layer, apply multi-head self-attention and then a feed-forward network, each with a residual connection and layer normalisation.',
      'In each decoder layer, apply masked self-attention, then attention over the encoder output, then a feed-forward network.',
      'Compute attention as softmax(QKᵀ / √d_k) · V.',
      'Predict the next token with a linear layer and softmax.',
    ],
    results:
      '28.4 BLEU on English–German and 41.8 on English–French, beating earlier models at a fraction of the training cost (3.5 days on 8 GPUs for the big model).',
    limitations:
      'Self-attention cost grows with the square of the sequence length. Experiments cover translation and English constituency parsing only.',
    evaluation: 'BLEU on the WMT 2014 test sets and training cost, with ablations of heads, key size and model size.',
    prerequisites: ['Softmax', 'Attention mechanism', 'Word embeddings'],
  },
  {
    field: 'Large Language Models',
    title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
    authors: 'Jacob Devlin, Ming-Wei Chang, Kenton Lee, Kristina Toutanova',
    year: 2018,
    paper_url: 'https://arxiv.org/abs/1810.04805',
    arxiv_id: '1810.04805',
    research_questions: [
      'Can a language model be pre-trained to use context from both sides of a word?',
      'Can one pre-trained model be fine-tuned for many tasks with little change?',
    ],
    main_idea:
      'BERT pre-trains a Transformer encoder by hiding random words and predicting them from both sides, and by predicting whether two sentences follow each other. One extra output layer then fine-tunes it for each task.',
    data_source: 'BooksCorpus (800M words) and English Wikipedia (2,500M words) for pre-training; GLUE, SQuAD and SWAG for evaluation.',
    method_steps: [
      'Split text into WordPiece tokens and pack sentence pairs with [CLS] and [SEP] markers.',
      'Mask 15% of tokens and train the encoder to predict them.',
      'Also train it to predict whether sentence B follows sentence A.',
      'For each task, add one output layer and fine-tune all the weights.',
    ],
    results: 'New best results on eleven NLP tasks, including a GLUE score of 80.5 and SQuAD v1.1 test F1 of 93.2.',
    limitations:
      'Pre-training is expensive. The [MASK] token never appears during fine-tuning. The encoder is not designed to generate text.',
    evaluation: 'Scores on GLUE, SQuAD v1.1 and v2.0, and SWAG, with ablations of the pre-training tasks and model size.',
    prerequisites: ['Transformers', 'Attention mechanism'],
  },
];

/** One starting roadmap per field, in reading order. A roadmap may use papers from other fields. */
export const roadmaps: Record<string, { paper: string; note: string }[]> = {
  'Machine Learning': [{ paper: 'Adam: A Method for Stochastic Optimization', note: 'How most models are trained today.' }],
  'Deep Learning': [
    { paper: 'Adam: A Method for Stochastic Optimization', note: 'The optimiser behind most deep networks.' },
    { paper: 'Deep Residual Learning for Image Recognition', note: 'Why very deep networks became trainable.' },
    { paper: 'Attention Is All You Need', note: 'Attention replaces recurrence.' },
  ],
  'Computer Vision': [
    { paper: 'Deep Residual Learning for Image Recognition', note: 'The backbone of most vision models.' },
  ],
  'Large Language Models': [
    { paper: 'Efficient Estimation of Word Representations in Vector Space', note: 'Start with how words become vectors.' },
    { paper: 'Attention Is All You Need', note: 'The architecture behind modern language models.' },
    {
      paper: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
      note: 'Pre-train once, then fine-tune for each task.',
    },
  ],
};
