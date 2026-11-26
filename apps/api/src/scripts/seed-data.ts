// Starter content for local testing: the five learn areas, concepts under them, short lessons,
// courses (ours and free outside ones), practice questions and a quiz, eight well-known papers with
// Paper Cards (several in Bangla too), Learn first links, lineage and one roadmap per area.
// `devActivity` is sample social and reading activity for the dev users; it is never seeded in
// production.

/** The learn areas, in chip order. They are `fields`, shared by Research, Learn and Explore. */
export const fields = [
  { name: 'ML fundamentals', description: 'Core methods for learning from data: optimisation, generalisation and evaluation.', position: 1 },
  { name: 'Deep learning', description: 'Training many-layered neural networks, and what keeps them stable.', position: 2 },
  { name: 'Computer vision', description: 'Models that understand images and video.', position: 3 },
  { name: 'Transformers', description: 'Attention-based models for sequences, and now for images too.', position: 4 },
  { name: 'LLMs', description: 'Large language models: pre-training, fine-tuning and prompting.', position: 5 },
];

/** Concepts, each filed under one area. */
export const topics = [
  { field: 'ML fundamentals', name: 'Gradient descent', summary: "Repeatedly nudges a model's parameters in the direction that lowers the loss." },
  { field: 'ML fundamentals', name: 'Softmax', summary: 'Turns a list of scores into probabilities that sum to one.' },
  { field: 'ML fundamentals', name: 'Overfitting and regularisation', summary: 'When a model memorises its training data instead of learning patterns that carry over, and the tools that prevent it.' },
  { field: 'Deep learning', name: 'Neural networks', summary: 'Layers of weighted sums and non-linear functions, trained to map inputs to outputs.' },
  { field: 'Deep learning', name: 'Backpropagation', summary: 'The chain rule applied layer by layer to find how much each weight changed the loss.' },
  { field: 'Deep learning', name: 'Residual connections', summary: "Shortcuts that add a block's input to its output, so very deep networks stay trainable." },
  { field: 'Computer vision', name: 'Convolutional neural networks', summary: 'Networks that slide small learned filters over an image to find local patterns.' },
  { field: 'Transformers', name: 'Attention mechanism', summary: 'Weighs every input position by how relevant it is to the one being processed.' },
  { field: 'Transformers', name: 'Positional encoding', summary: 'Information added to each token so that attention, which ignores order, knows where the token sits.' },
  { field: 'Transformers', name: 'Transformers', summary: 'Sequence models built from stacked self-attention and feed-forward layers, without recurrence.' },
  { field: 'LLMs', name: 'Word embeddings', summary: 'Dense vectors that place words with similar meanings close together.' },
  { field: 'LLMs', name: 'Tokenisation', summary: 'Splitting text into the pieces (tokens) a language model reads and writes.' },
  { field: 'LLMs', name: 'Pre-training and fine-tuning', summary: 'Learn general skills from a large unlabelled corpus first, then adapt to one task with a little labelled data.' },
  { field: 'LLMs', name: 'In-context learning', summary: 'A model picking up a task from instructions and examples in its prompt, without any weight updates.' },
];

type LearnItemSeed =
  | { topic: string; title: string; kind: 'text'; body: string }
  | { topic: string; title: string; kind: 'video'; media_url: string; duration_seconds: number; body?: string };

/** Short lessons. Text ones are ours; the two videos are free outside lessons we link to. */
export const learnItems: LearnItemSeed[] = [
  {
    topic: 'Gradient descent',
    kind: 'text',
    title: 'Gradient descent in one minute',
    body: 'Picture the loss as a hilly landscape. The gradient points uphill, so each step moves the parameters a little downhill: new weight = old weight − learning rate × gradient. Too large a learning rate overshoots; too small crawls.',
  },
  {
    topic: 'Backpropagation',
    kind: 'text',
    title: 'How backpropagation works',
    body: 'Run the network forward and measure the loss. Then walk backwards through the layers, using the chain rule to pass the gradient from each layer to the one before it. Every weight ends up with its own gradient for gradient descent to use.',
  },
  {
    topic: 'Softmax',
    kind: 'text',
    title: 'Softmax, step by step',
    body: 'Take each score, raise e to that power, and divide by the sum of all of them. Larger scores get larger shares, every output is between 0 and 1, and the outputs add up to 1.',
  },
  {
    topic: 'Attention mechanism',
    kind: 'text',
    title: 'What attention does',
    body: 'Each token makes a query and compares it with every token’s key. Softmax turns those similarity scores into weights, and the output is the weighted sum of the tokens’ values. So each token gathers information from the tokens that matter most to it.',
  },
  {
    topic: 'Overfitting and regularisation',
    kind: 'text',
    title: 'Overfitting, and how to spot it',
    body: 'Overfitting is when training error keeps falling but error on new data stops falling, or rises. The model is memorising noise. Watch both curves: when they split, stop training earlier, collect more data, or add regularisation such as weight decay or dropout.',
  },
  {
    topic: 'Neural networks',
    kind: 'text',
    title: 'Neural networks as stacked functions',
    body: 'A layer multiplies its input by a weight matrix, adds a bias and applies a non-linear function such as ReLU. Stack layers and you get a function that can bend to fit complicated data. Training means finding weights that make the final output match the labels.',
  },
  {
    topic: 'Residual connections',
    kind: 'text',
    title: 'Why residual connections help',
    body: 'A residual block computes output = F(x) + x. If the best thing a block can do is nothing, it only has to push F(x) towards zero, which is easy. And the + x gives gradients a direct path back to early layers, so they do not fade away in deep stacks.',
  },
  {
    topic: 'Convolutional neural networks',
    kind: 'text',
    title: 'Convolutions by hand',
    body: 'Slide a small grid of weights (say 3×3) over the image. At each position, multiply the overlapping pixels by the weights and add them up: that is one output pixel. The same filter is reused everywhere, so it finds the same pattern, such as an edge, wherever it appears.',
  },
  {
    topic: 'Positional encoding',
    kind: 'text',
    title: 'Positional encoding in plain words',
    body: 'Attention compares every token with every other, but on its own it has no idea which token came first. So before the first layer, each token gets a position vector added to it, built from sine and cosine waves of different frequencies. Now “dog bites man” and “man bites dog” look different.',
  },
  {
    topic: 'Tokenisation',
    kind: 'text',
    title: 'What a token is',
    body: 'Models read tokens, not letters or whole words. A tokenizer splits text into frequent pieces: common words stay whole, rare words break into parts. Languages the tokenizer saw less of, Bangla among them, often need more tokens for the same sentence.',
  },
  {
    topic: 'Pre-training and fine-tuning',
    kind: 'text',
    title: 'Pre-training, then fine-tuning',
    body: 'First, train on a huge amount of unlabelled text with a simple goal, such as predicting hidden or next words. The model learns grammar and facts along the way. Then train it a little more on a small labelled set for your task. The second step is cheap because the first did most of the work.',
  },
  {
    topic: 'Word embeddings',
    kind: 'text',
    title: 'Word vectors and analogies',
    body: 'Give every word a list of numbers and train them so that words used in similar contexts get similar vectors. Directions in that space start to mean something: the step from “man” to “woman” is close to the step from “king” to “queen”.',
  },
  {
    topic: 'Neural networks',
    kind: 'video',
    title: 'But what is a neural network? (3Blue1Brown)',
    media_url: 'https://www.youtube.com/watch?v=aircAruvnKk',
    duration_seconds: 1119,
  },
  {
    topic: 'Transformers',
    kind: 'video',
    title: 'Attention in transformers, step by step (3Blue1Brown)',
    media_url: 'https://www.youtube.com/watch?v=eMlx5fFNoYc',
    duration_seconds: 1570,
  },
];

/** Our own courses: ordered learn items. */
export const courses = [
  {
    field: 'Transformers',
    title: 'Foundations for reading Transformer papers',
    description: 'Five short lessons that cover what the Transformer paper assumes you know.',
    items: ['Gradient descent in one minute', 'How backpropagation works', 'Softmax, step by step', 'What attention does', 'Positional encoding in plain words'],
  },
  {
    field: 'ML fundamentals',
    title: 'ML fundamentals in four lessons',
    description: 'How models learn, how they turn scores into answers, and how to tell when they are fooling you.',
    items: ['Neural networks as stacked functions', 'Gradient descent in one minute', 'Softmax, step by step', 'Overfitting, and how to spot it'],
  },
  {
    field: 'Computer vision',
    title: 'How vision models see',
    description: 'From a single convolution to the residual networks behind most vision models.',
    items: ['Convolutions by hand', 'Why residual connections help', 'Overfitting, and how to spot it'],
  },
];

/** Free outside courses, shown as cards that open the link. */
export const externalCourses = [
  {
    field: 'ML fundamentals',
    title: 'Machine Learning Specialization (DeepLearning.AI, Stanford)',
    description: 'Andrew Ng’s beginner series on supervised learning, neural networks and practical advice. Free to audit on Coursera.',
    external_url: 'https://www.coursera.org/specializations/machine-learning-introduction',
  },
  {
    field: 'Deep learning',
    title: 'Practical Deep Learning for Coders (fast.ai)',
    description: 'A free, hands-on course that starts with working models and explains the theory along the way.',
    external_url: 'https://course.fast.ai/',
  },
  {
    field: 'Deep learning',
    title: 'Neural Networks: Zero to Hero (Andrej Karpathy)',
    description: 'Build neural networks from scratch in code, from backpropagation to a small GPT. Free on YouTube.',
    external_url: 'https://karpathy.ai/zero-to-hero.html',
  },
  {
    field: 'Computer vision',
    title: 'CS231n: Deep Learning for Computer Vision (Stanford)',
    description: 'Stanford’s course notes and assignments on CNNs, training tricks and modern vision models.',
    external_url: 'https://cs231n.stanford.edu/',
  },
  {
    field: 'Transformers',
    title: 'Hugging Face LLM Course',
    description: 'How Transformer models work and how to use, fine-tune and share them with the Hugging Face libraries. Free.',
    external_url: 'https://huggingface.co/learn/llm-course',
  },
  {
    field: 'LLMs',
    title: "Let's build GPT: from scratch, in code (Andrej Karpathy)",
    description: 'A two-hour walk through writing a small GPT, following “Attention Is All You Need”. Free on YouTube.',
    external_url: 'https://www.youtube.com/watch?v=kCc8FmEb1nY',
  },
];

type QuestionSeed =
  | { topic: string; kind: 'mcq'; prompt: string; options: string[]; answer: string; explanation: string }
  | { topic: string; kind: 'short'; prompt: string; answer: string; explanation: string };

export const questions: QuestionSeed[] = [
  {
    topic: 'Gradient descent',
    kind: 'mcq',
    prompt: 'In gradient descent, which way are the parameters moved?',
    options: ['Along the gradient', 'Against the gradient', 'In a random direction', 'Towards zero'],
    answer: 'Against the gradient',
    explanation: 'The gradient points towards the steepest increase in loss, so stepping the opposite way reduces it.',
  },
  {
    topic: 'Backpropagation',
    kind: 'short',
    prompt: 'Which rule from calculus does backpropagation apply?',
    answer: 'Chain rule',
    explanation: 'The gradient of each layer is the product of the local derivative and the gradient from the layer after it.',
  },
  {
    topic: 'Softmax',
    kind: 'short',
    prompt: 'What do the outputs of a softmax always add up to?',
    answer: '1',
    explanation: 'Each output is its exponential divided by the sum of all exponentials, so together they sum to one.',
  },
  {
    topic: 'Attention mechanism',
    kind: 'mcq',
    prompt: 'In scaled dot-product attention, what are the scores divided by?',
    options: ['The number of heads', 'The square root of the key dimension', 'The sequence length', 'The vocabulary size'],
    answer: 'The square root of the key dimension',
    explanation: 'Dividing by √d_k keeps the dot products from growing so large that softmax saturates.',
  },
  {
    topic: 'Attention mechanism',
    kind: 'mcq',
    prompt: 'In self-attention, where do the queries, keys and values come from?',
    options: ['All from the same sequence', 'Queries from the decoder, keys from a lookup table', 'From a fixed dictionary', 'From the previous step’s gradients'],
    answer: 'All from the same sequence',
    explanation: 'Self-attention projects the same input sequence three ways, so every token can attend to every other token of that sequence.',
  },
  {
    topic: 'Overfitting and regularisation',
    kind: 'mcq',
    prompt: 'A model scores 99% on its training data and 70% on new data. What is this called?',
    options: ['Underfitting', 'Overfitting', 'Normalisation', 'Convergence'],
    answer: 'Overfitting',
    explanation: 'A large gap between training and test performance means the model memorised the training set instead of learning patterns that generalise.',
  },
  {
    topic: 'Overfitting and regularisation',
    kind: 'mcq',
    prompt: 'What does dropout do during training?',
    options: ['Randomly switches off units', 'Removes layers that do not help', 'Lowers the learning rate', 'Drops the hardest training examples'],
    answer: 'Randomly switches off units',
    explanation: 'Each unit is dropped with some probability on every training case, so the network cannot rely on any single unit.',
  },
  {
    topic: 'Convolutional neural networks',
    kind: 'mcq',
    prompt: 'In a convolutional layer, what slides over the image?',
    options: ['A small learned filter', 'A fully connected layer', 'A softmax', 'The loss function'],
    answer: 'A small learned filter',
    explanation: 'The same small grid of weights is applied at every position, so it detects the same pattern anywhere in the image.',
  },
  {
    topic: 'Residual connections',
    kind: 'mcq',
    prompt: 'What does a residual block add to its output?',
    options: ['Its own input', 'Random noise', 'The class label', 'The learning rate'],
    answer: 'Its own input',
    explanation: 'A residual block computes F(x) + x: the shortcut carries the input past the block and adds it back.',
  },
  {
    topic: 'Positional encoding',
    kind: 'mcq',
    prompt: 'Why does a Transformer need positional encoding?',
    options: ['Self-attention on its own ignores word order', 'To make the model smaller', 'To replace softmax', 'To speed up tokenisation'],
    answer: 'Self-attention on its own ignores word order',
    explanation: 'Attention treats its input as a set. Adding position information lets the model tell “dog bites man” from “man bites dog”.',
  },
  {
    topic: 'Word embeddings',
    kind: 'short',
    prompt: 'In word2vec, the vector for king − man + woman is closest to which word?',
    answer: 'queen',
    explanation: 'Directions in the embedding space capture relationships, so the gender step from man to woman also leads from king to queen.',
  },
  {
    topic: 'In-context learning',
    kind: 'mcq',
    prompt: 'What does GPT-3 do with the examples placed in its prompt?',
    options: ['Uses them in context, without changing its weights', 'Fine-tunes its weights on them', 'Ignores them', 'Saves them for the next user'],
    answer: 'Uses them in context, without changing its weights',
    explanation: 'In-context learning happens entirely in the forward pass: the examples steer the output, but no gradient step is taken.',
  },
];

/** Named question sets, by prompt, in order. */
export const quizzes = [
  {
    topic: 'Attention mechanism',
    title: 'Attention basics',
    questions: [
      'What do the outputs of a softmax always add up to?',
      'In self-attention, where do the queries, keys and values come from?',
      'In scaled dot-product attention, what are the scores divided by?',
    ],
  },
  {
    topic: 'Overfitting and regularisation',
    title: 'Overfitting check',
    questions: ['A model scores 99% on its training data and 70% on new data. What is this called?', 'What does dropout do during training?'],
  },
];

/** A Learn first row: a concept, why it matters, and at most one link (a learn item title or a quiz title). */
interface PrerequisiteSeed {
  topic: string;
  why: string;
  label?: string;
  lesson?: string;
  quiz?: string;
}

interface CardSeed {
  question: string;
  extra_questions?: string[];
  problem?: string;
  key_idea: string;
  data_source?: string;
  method_steps?: string[];
  findings?: string;
  evaluation?: string;
  limitations?: string;
  takeaway?: string;
  glossary?: { term: string; definition: string }[];
}

interface PaperSeed {
  field: string;
  title: string;
  authors: string;
  year: number;
  venue: string;
  published_on: string | null;
  paper_url: string;
  pdf_url: string | null;
  code_url: string | null;
  arxiv_id: string | null;
  en: CardSeed;
  bn?: CardSeed;
  prerequisites: PrerequisiteSeed[];
}

export const papers: PaperSeed[] = [
  {
    field: 'ML fundamentals',
    title: 'Adam: A Method for Stochastic Optimization',
    authors: 'Diederik P. Kingma, Jimmy Ba',
    year: 2014,
    venue: 'ICLR 2015',
    published_on: '2014-12-22',
    paper_url: 'https://arxiv.org/abs/1412.6980',
    pdf_url: 'https://arxiv.org/pdf/1412.6980',
    code_url: null,
    arxiv_id: '1412.6980',
    en: {
      question: 'Can one optimiser give every parameter its own step size using only first-order gradients?',
      extra_questions: ['Can it stay efficient on large, noisy and sparse problems?'],
      problem: 'Plain stochastic gradient descent uses one learning rate for every parameter, which is slow when gradients are noisy or some parameters are rarely updated.',
      key_idea:
        "Adam keeps running averages of each parameter's gradient and squared gradient, corrects their bias towards zero early in training, and uses their ratio to set a separate step size for every parameter.",
      data_source: 'Logistic regression on MNIST and IMDB, multilayer networks on MNIST, and convolutional networks on CIFAR-10.',
      method_steps: [
        'Compute the gradient of the loss on a mini-batch.',
        'Update a moving average of the gradient (first moment).',
        'Update a moving average of the squared gradient (second moment).',
        'Correct both averages for their bias towards zero in early steps.',
        'Move each parameter by the corrected first moment divided by the square root of the corrected second moment.',
      ],
      findings: 'Adam converged as fast as or faster than SGD with momentum, AdaGrad and RMSProp on the tested models, with little tuning of its defaults.',
      evaluation: 'Training loss curves against other optimisers on the same models and data.',
      limitations:
        'The convergence proof assumes convex problems. Later work showed Adam can fail to converge in some cases and may generalise worse than SGD on some tasks.',
      takeaway: 'Adaptive per-parameter steps with sensible defaults: the reason most models today train with little learning-rate tuning.',
      glossary: [
        { term: 'Moment', definition: 'A running average: the first moment of the gradient, and the second moment of its square.' },
        { term: 'Bias correction', definition: 'Rescaling the averages early in training, when they start at zero and are too small.' },
      ],
    },
    bn: {
      question: 'শুধু first-order gradient ব্যবহার করে কি প্রতিটি প্যারামিটারকে আলাদা step size দেওয়া যায়?',
      extra_questions: ['বড়, noisy আর sparse সমস্যাতেও কি এটি দক্ষ থাকে?'],
      problem: 'সাধারণ SGD সব প্যারামিটারের জন্য একই learning rate ব্যবহার করে, তাই gradient noisy হলে বা কিছু প্যারামিটার কম আপডেট হলে ট্রেনিং ধীর হয়ে যায়।',
      key_idea:
        'Adam প্রতিটি প্যারামিটারের gradient আর gradient-এর বর্গের চলমান গড় রাখে, শুরুর দিকের শূন্য-ঘেঁষা bias ঠিক করে, তারপর এই দুইয়ের অনুপাত দিয়ে প্রতিটি প্যারামিটারের আলাদা step size ঠিক করে।',
      method_steps: [
        'একটি mini-batch-এ loss-এর gradient হিসাব করা হয়।',
        'Gradient-এর চলমান গড় (first moment) আপডেট করা হয়।',
        'Gradient-এর বর্গের চলমান গড় (second moment) আপডেট করা হয়।',
        'শুরুর দিকের bias দূর করতে দুটি গড়ই সংশোধন করা হয়।',
        'সংশোধিত first moment-কে second moment-এর বর্গমূল দিয়ে ভাগ করে প্রতিটি প্যারামিটার সরানো হয়।',
      ],
      takeaway: 'প্রতিটি প্যারামিটারের জন্য নিজস্ব step আর ভালো default — তাই আজ বেশিরভাগ মডেল learning rate নিয়ে বেশি না ভেবেই ট্রেন করা যায়।',
    },
    prerequisites: [{ topic: 'Gradient descent', why: 'Adam is a smarter way to take gradient descent steps.', lesson: 'Gradient descent in one minute' }],
  },
  {
    field: 'Deep learning',
    title: 'Dropout: A Simple Way to Prevent Neural Networks from Overfitting',
    authors: 'Nitish Srivastava, Geoffrey Hinton, Alex Krizhevsky, Ilya Sutskever, Ruslan Salakhutdinov',
    year: 2014,
    venue: 'JMLR 2014',
    published_on: null,
    paper_url: 'https://jmlr.org/papers/v15/srivastava14a.html',
    pdf_url: 'https://jmlr.org/papers/volume15/srivastava14a/srivastava14a.pdf',
    code_url: null,
    arxiv_id: null,
    en: {
      question: 'Can randomly switching off neurons during training stop large networks from overfitting?',
      problem: 'Large networks overfit small datasets, and averaging many separately trained networks is too slow to be practical.',
      key_idea:
        'During training, each unit is dropped with some probability, so the network cannot rely on any single unit. At test time all units are used with their weights scaled down, which approximates averaging an exponential number of thinned networks.',
      data_source: 'MNIST, SVHN, CIFAR-10 and CIFAR-100, ImageNet, TIMIT speech, Reuters news text and a gene-splicing dataset.',
      method_steps: [
        'For each training case, keep each unit with probability p (often 0.5 for hidden units).',
        'Train the thinned network with backpropagation as usual.',
        "At test time, use the full network and multiply each unit's outgoing weights by p.",
        'Optionally combine it with a max-norm limit on the weights.',
      ],
      findings: 'Dropout lowered test error on vision, speech, text and biology tasks, and set new best results on several benchmarks of the time.',
      evaluation: 'Test error of the same architectures with and without dropout, and against other regularisers.',
      limitations: 'Training takes two to three times longer, because the gradients become noisier.',
      takeaway: 'Training many random sub-networks at once is a cheap and strong regulariser.',
    },
    prerequisites: [
      { topic: 'Neural networks', why: 'Dropout switches off units inside a network, so know what a unit is.', lesson: 'But what is a neural network? (3Blue1Brown)' },
      { topic: 'Overfitting and regularisation', why: 'Overfitting is the problem this paper solves.', lesson: 'Overfitting, and how to spot it' },
    ],
  },
  {
    field: 'Computer vision',
    title: 'Deep Residual Learning for Image Recognition',
    authors: 'Kaiming He, Xiangyu Zhang, Shaoqing Ren, Jian Sun',
    year: 2015,
    venue: 'CVPR 2016',
    published_on: '2015-12-10',
    paper_url: 'https://arxiv.org/abs/1512.03385',
    pdf_url: 'https://arxiv.org/pdf/1512.03385',
    code_url: 'https://github.com/KaimingHe/deep-residual-networks',
    arxiv_id: '1512.03385',
    en: {
      question: 'Why do deeper plain networks reach worse training error than shallower ones?',
      extra_questions: ['Can very deep networks be trained by learning residual functions instead?'],
      problem: 'Adding layers to a plain network made its training error go up, not down. This “degradation” was not overfitting: deeper networks were simply harder to optimise.',
      key_idea:
        'Each block learns only the difference (residual) from its input, and a shortcut connection adds the input back. This made networks with over 100 layers trainable.',
      data_source: 'ImageNet (ILSVRC 2012) classification, CIFAR-10, and COCO for object detection.',
      method_steps: [
        'Group layers into blocks of two or three convolutions.',
        "Add an identity shortcut that carries each block's input to its output.",
        'Add the block output and the shortcut, then apply the activation.',
        'Stack many blocks, using bottleneck blocks for the 50, 101 and 152-layer models.',
      ],
      findings:
        'An ensemble of residual networks reached 3.57% top-5 error on ImageNet and won ILSVRC 2015 classification. Deeper residual networks trained better than plain networks of the same depth.',
      evaluation: 'Top-1 and top-5 error on ImageNet and error on CIFAR-10, compared with plain networks and earlier models.',
      limitations: 'A 1202-layer network on CIFAR-10 did worse than a 110-layer one, likely from overfitting. Why residuals help is shown mostly through experiments.',
      takeaway: 'Shortcut connections made depth usable. Almost every modern vision and language model has them.',
      glossary: [
        { term: 'Residual', definition: 'What a block adds on top of its input: the block learns F(x), and outputs F(x) + x.' },
        { term: 'Top-5 error', definition: 'How often the right label is not among the model’s five best guesses.' },
      ],
    },
    bn: {
      question: 'গভীর plain নেটওয়ার্কের ট্রেনিং error কেন অগভীর নেটওয়ার্কের চেয়েও বেশি হয়?',
      extra_questions: ['Residual ফাংশন শেখালে কি অনেক গভীর নেটওয়ার্কও ট্রেন করা যায়?'],
      problem: 'লেয়ার বাড়ালে সাধারণ নেটওয়ার্কের ট্রেনিং error কমার বদলে বেড়ে যাচ্ছিল। এটা overfitting নয়: গভীর নেটওয়ার্ককে optimise করাই কঠিন হয়ে পড়ছিল।',
      key_idea:
        'প্রতিটি ব্লক তার ইনপুট থেকে শুধু পার্থক্যটুকু (residual) শেখে, আর একটি shortcut connection ইনপুটকে আউটপুটের সাথে আবার যোগ করে দেয়। এতে 100-এর বেশি লেয়ারের নেটওয়ার্কও ট্রেন করা সম্ভব হয়।',
      data_source: 'ImageNet (ILSVRC 2012) ক্লাসিফিকেশন, CIFAR-10, এবং object detection-এর জন্য COCO।',
      method_steps: [
        'দুই বা তিনটি convolution লেয়ার নিয়ে একটি ব্লক তৈরি করা হয়।',
        'প্রতিটি ব্লকের ইনপুটকে সরাসরি আউটপুটে নিয়ে যেতে একটি identity shortcut যোগ করা হয়।',
        'ব্লকের আউটপুট আর shortcut যোগ করে তারপর activation প্রয়োগ করা হয়।',
        'অনেকগুলো ব্লক পরপর সাজানো হয়; 50, 101 ও 152 লেয়ারের মডেলে bottleneck ব্লক ব্যবহার করা হয়।',
      ],
      findings:
        'Residual নেটওয়ার্কের একটি ensemble ImageNet-এ 3.57% top-5 error পেয়ে ILSVRC 2015 ক্লাসিফিকেশন জিতেছে। একই গভীরতায় residual নেটওয়ার্ক plain নেটওয়ার্কের চেয়ে ভালো ট্রেন হয়েছে।',
      evaluation: 'ImageNet-এ top-1 ও top-5 error এবং CIFAR-10-এ error, plain নেটওয়ার্ক ও আগের মডেলগুলোর সাথে তুলনা করে।',
      limitations: 'CIFAR-10-এ 1202 লেয়ারের নেটওয়ার্ক 110 লেয়ারেরটার চেয়ে খারাপ করেছে, সম্ভবত overfitting-এর কারণে। Residual কেন কাজ করে, তা মূলত পরীক্ষা দিয়ে দেখানো হয়েছে।',
      takeaway: 'শর্টকাট কানেকশন গভীর নেটওয়ার্ককে ট্রেনযোগ্য করেছে। আজকের প্রায় সব ভিশন ও ভাষা মডেলে এটি আছে।',
      glossary: [
        { term: 'Residual', definition: 'ব্লক তার ইনপুটের ওপর যা যোগ করে: ব্লক শেখে F(x), আর আউটপুট দেয় F(x) + x।' },
        { term: 'Top-5 error', definition: 'মডেলের সেরা পাঁচটি অনুমানের মধ্যে সঠিক লেবেল কত বার থাকে না।' },
      ],
    },
    prerequisites: [
      { topic: 'Convolutional neural networks', why: 'ResNet is built from stacks of convolutions.', lesson: 'Convolutions by hand' },
      { topic: 'Backpropagation', why: 'The paper is about gradients that fail to flow through deep stacks.', lesson: 'How backpropagation works' },
      { topic: 'Residual connections', why: 'The one idea the whole paper rests on.', lesson: 'Why residual connections help' },
    ],
  },
  {
    field: 'LLMs',
    title: 'Efficient Estimation of Word Representations in Vector Space',
    authors: 'Tomas Mikolov, Kai Chen, Greg Corrado, Jeffrey Dean',
    year: 2013,
    venue: 'ICLR 2013 (workshop)',
    published_on: '2013-01-16',
    paper_url: 'https://arxiv.org/abs/1301.3781',
    pdf_url: 'https://arxiv.org/pdf/1301.3781',
    code_url: 'https://code.google.com/archive/p/word2vec/',
    arxiv_id: '1301.3781',
    en: {
      question: 'Can high-quality word vectors be learned cheaply from billions of words?',
      extra_questions: ['Do simple models capture syntactic and semantic relationships between words?'],
      problem: 'Neural language models gave good word vectors but took weeks to train, so they could not use the billions of words available.',
      key_idea:
        'Two shallow models, CBOW (predict a word from its neighbours) and Skip-gram (predict the neighbours from a word), learn word vectors much faster than earlier neural language models. The vectors capture relationships such as king − man + woman ≈ queen.',
      data_source: 'A Google News corpus of about 6 billion tokens, and a word-analogy test set built by the authors.',
      method_steps: [
        'Slide a window over the text.',
        'CBOW: combine the context word vectors and predict the centre word.',
        'Skip-gram: use the centre word to predict each context word.',
        'Use hierarchical softmax to keep training cheap on a large vocabulary.',
        'Test the vectors on analogy questions using vector arithmetic.',
      ],
      findings: 'The models trained in hours rather than weeks and beat earlier neural models on the analogy test. Skip-gram did best on semantic questions.',
      evaluation: 'Accuracy on semantic and syntactic analogy questions, plus training time.',
      limitations: 'One vector per word, so different meanings of a word are merged. Word order is ignored beyond the window.',
      takeaway: 'Meaning can be learned from context alone, cheaply, at the scale of the web.',
    },
    prerequisites: [
      { topic: 'Word embeddings', why: 'The paper is a fast way to learn them.', lesson: 'Word vectors and analogies' },
      { topic: 'Neural networks', why: 'CBOW and Skip-gram are tiny neural networks.', lesson: 'But what is a neural network? (3Blue1Brown)' },
    ],
  },
  {
    field: 'Transformers',
    title: 'Attention Is All You Need',
    authors: 'Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N. Gomez, Łukasz Kaiser, Illia Polosukhin',
    year: 2017,
    venue: 'NeurIPS 2017',
    published_on: '2017-06-12',
    paper_url: 'https://arxiv.org/abs/1706.03762',
    pdf_url: 'https://arxiv.org/pdf/1706.03762',
    code_url: 'https://github.com/tensorflow/tensor2tensor',
    arxiv_id: '1706.03762',
    en: {
      question: 'Can a sequence model rely on attention alone, without recurrence or convolution?',
      extra_questions: ['Does that train faster and translate better?'],
      problem:
        'Recurrent networks process one token after another, so training cannot be parallelised across a sentence, and links between distant words are hard to learn.',
      key_idea:
        'The Transformer replaces recurrent layers with self-attention, so every position looks at every other position at once. Stacked multi-head attention and feed-forward layers, plus positional encodings, form an encoder and a decoder.',
      data_source: 'WMT 2014 English–German (about 4.5 million sentence pairs) and English–French (about 36 million sentence pairs).',
      method_steps: [
        'Embed the input tokens and add positional encodings.',
        'In each encoder layer, apply multi-head self-attention and then a feed-forward network, each with a residual connection and layer normalisation.',
        'In each decoder layer, apply masked self-attention, then attention over the encoder output, then a feed-forward network.',
        'Compute attention as softmax(QKᵀ / √d_k) · V.',
        'Predict the next token with a linear layer and softmax.',
      ],
      findings:
        '28.4 BLEU on English–German and 41.8 on English–French, beating earlier models at a fraction of the training cost (3.5 days on 8 GPUs for the big model).',
      evaluation: 'BLEU on the WMT 2014 test sets and training cost, with ablations of heads, key size and model size.',
      limitations: 'Self-attention cost grows with the square of the sequence length. Experiments cover translation and English constituency parsing only.',
      takeaway: 'Attention alone is enough. This design is the base of nearly every large language model today.',
      glossary: [
        { term: 'Self-attention', definition: 'Each position in a sequence learns how much to draw on every other position of the same sequence.' },
        { term: 'Multi-head', definition: 'Several attention operations run side by side, each free to focus on a different kind of relationship.' },
        { term: 'BLEU', definition: 'A score for how close a machine translation is to human reference translations.' },
      ],
    },
    bn: {
      question: 'রিকারেন্স বা কনভলিউশন ছাড়া শুধু attention দিয়েই কি একটি সিকোয়েন্স মডেল বানানো যায়?',
      extra_questions: ['এতে কি ট্রেনিং দ্রুত হয় আর অনুবাদ আরও ভালো হয়?'],
      problem: 'RNN একটার পর একটা টোকেন প্রসেস করে, তাই পুরো বাক্যে একসাথে ট্রেনিং চালানো যায় না, আর দূরের শব্দের সম্পর্ক শেখাও কঠিন।',
      key_idea:
        'Transformer রিকারেন্ট লেয়ারের বদলে self-attention ব্যবহার করে, ফলে প্রতিটি অবস্থান একসাথে বাকি সব অবস্থানের দিকে তাকাতে পারে। Multi-head attention, feed-forward লেয়ার আর positional encoding মিলে তৈরি হয় encoder ও decoder।',
      data_source: 'WMT 2014 ইংরেজি–জার্মান (প্রায় 45 লাখ বাক্য-জোড়া) এবং ইংরেজি–ফরাসি (প্রায় 3.6 কোটি বাক্য-জোড়া)।',
      method_steps: [
        'ইনপুট টোকেনগুলোকে embedding-এ রূপান্তর করে তার সাথে positional encoding যোগ করা হয়।',
        'প্রতিটি encoder লেয়ারে multi-head self-attention, তারপর একটি feed-forward নেটওয়ার্ক; প্রতিটির সাথে residual connection ও layer normalisation।',
        'Decoder লেয়ারে প্রথমে masked self-attention, তারপর encoder-এর আউটপুটের ওপর attention, শেষে feed-forward নেটওয়ার্ক।',
        'Attention হিসাব করা হয় softmax(QKᵀ / √d_k) · V সূত্রে।',
        'শেষে একটি linear লেয়ার ও softmax দিয়ে পরের টোকেন অনুমান করা হয়।',
      ],
      findings: 'ইংরেজি–জার্মানে 28.4 BLEU আর ইংরেজি–ফরাসিতে 41.8 BLEU: আগের মডেলগুলোর চেয়ে ভালো, আর ট্রেনিং খরচ অনেক কম (বড় মডেল 8টি GPU-তে 3.5 দিন)।',
      evaluation: 'WMT 2014 টেস্ট সেটে BLEU স্কোর ও ট্রেনিং খরচ; head-এর সংখ্যা, key-এর মাপ ও মডেলের আকার বদলে ablation।',
      limitations: 'Self-attention-এর খরচ সিকোয়েন্সের দৈর্ঘ্যের বর্গের হারে বাড়ে। পরীক্ষা শুধু অনুবাদ আর ইংরেজি constituency parsing-এ।',
      takeaway: 'Attention একাই যথেষ্ট। আজকের প্রায় সব বড় ভাষা মডেলের ভিত্তি এই নকশা।',
      glossary: [
        { term: 'Self-attention', definition: 'একটি সিকোয়েন্সের প্রতিটি অবস্থান একই সিকোয়েন্সের বাকি অবস্থানগুলোকে কতটা গুরুত্ব দেবে, তা শেখার পদ্ধতি।' },
        { term: 'BLEU', definition: 'মেশিন অনুবাদ মানুষের অনুবাদের কতটা কাছাকাছি, তা মাপার একটি স্কোর।' },
      ],
    },
    prerequisites: [
      { topic: 'Softmax', why: 'Attention weights are a softmax over similarity scores.', lesson: 'Softmax, step by step' },
      { topic: 'Attention mechanism', why: 'The paper builds the whole model out of it.', quiz: 'Attention basics' },
      { topic: 'Word embeddings', why: 'Tokens enter the model as vectors.' },
      { topic: 'Positional encoding', why: 'Explains how the model knows word order without recurrence.', lesson: 'Positional encoding in plain words' },
      { topic: 'Residual connections', why: 'Every sub-layer is wrapped in one.', lesson: 'Why residual connections help' },
    ],
  },
  {
    field: 'LLMs',
    title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
    authors: 'Jacob Devlin, Ming-Wei Chang, Kenton Lee, Kristina Toutanova',
    year: 2018,
    venue: 'NAACL 2019',
    published_on: '2018-10-11',
    paper_url: 'https://arxiv.org/abs/1810.04805',
    pdf_url: 'https://arxiv.org/pdf/1810.04805',
    code_url: 'https://github.com/google-research/bert',
    arxiv_id: '1810.04805',
    en: {
      question: 'Can a language model be pre-trained to use context from both sides of a word?',
      extra_questions: ['Can one pre-trained model be fine-tuned for many tasks with little change?'],
      problem: 'Earlier pre-trained language models read text in one direction only, which limits how well they understand a word in its full context.',
      key_idea:
        'BERT pre-trains a Transformer encoder by hiding random words and predicting them from both sides, and by predicting whether two sentences follow each other. One extra output layer then fine-tunes it for each task.',
      data_source: 'BooksCorpus (800M words) and English Wikipedia (2,500M words) for pre-training; GLUE, SQuAD and SWAG for evaluation.',
      method_steps: [
        'Split text into WordPiece tokens and pack sentence pairs with [CLS] and [SEP] markers.',
        'Mask 15% of tokens and train the encoder to predict them.',
        'Also train it to predict whether sentence B follows sentence A.',
        'For each task, add one output layer and fine-tune all the weights.',
      ],
      findings: 'New best results on eleven NLP tasks, including a GLUE score of 80.5 and SQuAD v1.1 test F1 of 93.2.',
      evaluation: 'Scores on GLUE, SQuAD v1.1 and v2.0, and SWAG, with ablations of the pre-training tasks and model size.',
      limitations: 'Pre-training is expensive. The [MASK] token never appears during fine-tuning. The encoder is not designed to generate text.',
      takeaway: 'Pre-train once on plain text, then fine-tune cheaply for each task.',
    },
    prerequisites: [
      { topic: 'Transformers', why: 'BERT is the encoder half of a Transformer.', lesson: 'Attention in transformers, step by step (3Blue1Brown)' },
      { topic: 'Attention mechanism', why: 'Bidirectional context comes from self-attention.', lesson: 'What attention does' },
      { topic: 'Pre-training and fine-tuning', why: 'The two-stage recipe the paper made standard.', lesson: 'Pre-training, then fine-tuning' },
      { topic: 'Tokenisation', why: 'BERT reads WordPiece tokens.', lesson: 'What a token is' },
    ],
  },
  {
    field: 'Computer vision',
    title: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale',
    authors:
      'Alexey Dosovitskiy, Lucas Beyer, Alexander Kolesnikov, Dirk Weissenborn, Xiaohua Zhai, Thomas Unterthiner, Mostafa Dehghani, Matthias Minderer, Georg Heigold, Sylvain Gelly, Jakob Uszkoreit, Neil Houlsby',
    year: 2020,
    venue: 'ICLR 2021',
    published_on: '2020-10-22',
    paper_url: 'https://arxiv.org/abs/2010.11929',
    pdf_url: 'https://arxiv.org/pdf/2010.11929',
    code_url: 'https://github.com/google-research/vision_transformer',
    arxiv_id: '2010.11929',
    en: {
      question: 'Can a plain Transformer, with no convolutions, classify images as well as CNNs?',
      extra_questions: ['How much pre-training data does it need to get there?'],
      problem: 'Attention had taken over language, but vision still relied on convolutional networks, and earlier attempts to use attention for images needed special designs that were hard to scale.',
      key_idea:
        'Split an image into 16×16 patches, turn each into a vector, and feed the sequence of patch vectors to a standard Transformer encoder with a learnable class token. Pre-trained on enough data, it matches or beats strong CNNs.',
      data_source: 'Pre-training on ImageNet, ImageNet-21k (14M images) and JFT-300M; transfer to ImageNet, CIFAR-10 and CIFAR-100, Oxford Pets, Oxford Flowers and the VTAB suite.',
      method_steps: [
        'Cut the image into fixed-size patches of 16×16 pixels.',
        'Flatten each patch and project it to an embedding with a linear layer.',
        'Put a learnable [class] token in front and add position embeddings.',
        'Run the sequence through a standard Transformer encoder.',
        "Classify from the [class] token's final state, and fine-tune at a higher resolution for each task.",
      ],
      findings:
        'Pre-trained on JFT-300M, ViT-H/14 reached 88.55% top-1 accuracy on ImageNet, matching or beating the best CNNs with less pre-training compute. Trained on ImageNet alone, ViT trailed comparable ResNets.',
      evaluation: 'Top-1 accuracy after fine-tuning on each benchmark, and pre-training compute in TPUv3-core-days.',
      limitations: 'It needs very large pre-training datasets: with mid-sized data it does worse than CNNs, which have built-in assumptions about images. Only classification was tested.',
      takeaway: 'Treat an image as a sentence of patches: with enough data, the Transformer works for vision too.',
    },
    prerequisites: [
      { topic: 'Transformers', why: 'ViT uses the Transformer encoder unchanged.', lesson: 'Attention in transformers, step by step (3Blue1Brown)' },
      { topic: 'Attention mechanism', why: 'Every patch attends to every other patch.', quiz: 'Attention basics' },
      { topic: 'Convolutional neural networks', why: 'The paper is measured against CNNs, so know what it replaces.', lesson: 'Convolutions by hand' },
    ],
  },
  {
    field: 'LLMs',
    title: 'Language Models are Few-Shot Learners',
    authors: 'Tom B. Brown, Benjamin Mann, Nick Ryder, Melanie Subbiah, Jared Kaplan, Prafulla Dhariwal, Arvind Neelakantan, et al.',
    year: 2020,
    venue: 'NeurIPS 2020',
    published_on: '2020-05-28',
    paper_url: 'https://arxiv.org/abs/2005.14165',
    pdf_url: 'https://arxiv.org/pdf/2005.14165',
    code_url: null,
    arxiv_id: '2005.14165',
    en: {
      question: 'Can a large enough language model do new tasks from a few examples in its prompt, with no fine-tuning?',
      extra_questions: ['How does this ability change as the model grows?'],
      problem: 'Pre-trained models still needed a fine-tuning set of thousands of labelled examples for every new task, while people can pick up a task from a few examples.',
      key_idea:
        'GPT-3 is a 175-billion-parameter decoder-only Transformer trained to predict the next token. Given a task description and a few examples in the prompt, it performs the task without any weight updates: in-context learning.',
      data_source: 'About 300 billion tokens drawn from filtered Common Crawl, WebText2, two book corpora and English Wikipedia.',
      method_steps: [
        'Train eight model sizes, from 125 million to 175 billion parameters, on the same data.',
        'Use a decoder-only Transformer with alternating dense and sparse attention layers.',
        'At test time, put a task description and zero, one or a few examples in the prompt.',
        'Let the model complete the prompt, with no gradient updates.',
      ],
      findings:
        'Few-shot performance rose steadily with model size. GPT-3 was competitive with fine-tuned systems on some tasks, such as TriviaQA, and wrote news articles people struggled to tell from human-written ones, but it lagged on others, such as natural language inference.',
      evaluation: 'Zero-, one- and few-shot results on over two dozen NLP benchmarks, with checks for test data that leaked into the training set.',
      limitations: 'Very expensive to train and run. It still makes factual and reasoning mistakes, can repeat biases in its training data, and some benchmark data overlapped with the training data.',
      takeaway: 'Scale turned prompting into a way to teach: show a model a few examples and it adapts in context.',
    },
    prerequisites: [
      { topic: 'Transformers', why: 'GPT-3 is a very large Transformer decoder.', lesson: 'Attention in transformers, step by step (3Blue1Brown)' },
      { topic: 'Pre-training and fine-tuning', why: 'The paper asks whether the fine-tuning step can be skipped.', lesson: 'Pre-training, then fine-tuning' },
      { topic: 'In-context learning', why: "The paper's main claim is about learning from the prompt." },
    ],
  },
];

/** Citations between papers in the collection: citing → cited, with the citation's intent. */
export const edges: { citing: string; cited: string; intent: 'background' | 'supporting'; influential?: boolean }[] = [
  { citing: 'Attention Is All You Need', cited: 'Deep Residual Learning for Image Recognition', intent: 'supporting' },
  { citing: 'Attention Is All You Need', cited: 'Adam: A Method for Stochastic Optimization', intent: 'supporting' },
  { citing: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', cited: 'Attention Is All You Need', intent: 'supporting', influential: true },
  { citing: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', cited: 'Efficient Estimation of Word Representations in Vector Space', intent: 'background' },
  { citing: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', cited: 'Adam: A Method for Stochastic Optimization', intent: 'supporting' },
  { citing: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale', cited: 'Attention Is All You Need', intent: 'supporting', influential: true },
  { citing: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale', cited: 'Deep Residual Learning for Image Recognition', intent: 'background' },
  { citing: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale', cited: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', intent: 'background' },
  { citing: 'Language Models are Few-Shot Learners', cited: 'Attention Is All You Need', intent: 'supporting', influential: true },
  { citing: 'Language Models are Few-Shot Learners', cited: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', intent: 'background' },
];

/** One starting roadmap per area, in reading order. A roadmap may use papers from other areas. */
export const roadmaps: Record<string, { paper: string; note: string }[]> = {
  'ML fundamentals': [
    { paper: 'Adam: A Method for Stochastic Optimization', note: 'How most models are trained today.' },
    { paper: 'Dropout: A Simple Way to Prevent Neural Networks from Overfitting', note: 'The classic fix for overfitting.' },
  ],
  'Deep learning': [
    { paper: 'Dropout: A Simple Way to Prevent Neural Networks from Overfitting', note: 'Keeping big networks from memorising.' },
    { paper: 'Adam: A Method for Stochastic Optimization', note: 'The optimiser behind most deep networks.' },
    { paper: 'Deep Residual Learning for Image Recognition', note: 'Why very deep networks became trainable.' },
    { paper: 'Attention Is All You Need', note: 'Attention replaces recurrence.' },
  ],
  'Computer vision': [
    { paper: 'Deep Residual Learning for Image Recognition', note: 'The backbone of most vision models.' },
    { paper: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale', note: 'Transformers arrive in vision.' },
  ],
  Transformers: [
    { paper: 'Attention Is All You Need', note: 'The architecture itself.' },
    { paper: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', note: 'Pre-train the encoder, then fine-tune.' },
    { paper: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale', note: 'The same model reads images as patches.' },
  ],
  LLMs: [
    { paper: 'Efficient Estimation of Word Representations in Vector Space', note: 'Start with how words become vectors.' },
    { paper: 'Attention Is All You Need', note: 'The architecture behind modern language models.' },
    { paper: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', note: 'Pre-train once, then fine-tune for each task.' },
    { paper: 'Language Models are Few-Shot Learners', note: 'Scale makes prompting work.' },
  ],
};

// ---------------------------------------------------------------------------------------------
// Dev activity: sample social and reading activity for the seeded dev accounts. Never in production.
// ---------------------------------------------------------------------------------------------

export const devProfiles: Record<string, { display_name: string; bio: string }> = {
  admin: { display_name: 'Doshomik team', bio: 'We write the paper cards, courses and quizzes.' },
  learner1: { display_name: 'Tanvir Ahmed', bio: 'CSE student. Reading my way into LLMs.' },
  learner2: { display_name: 'Ayesha Rahman', bio: 'কম্পিউটার ভিশন নিয়ে পড়ছি। ছবি থেকে শেখা মডেল ভালো লাগে।' },
};

/** follower → following, all accepted. learner2 doesn't follow learner1, so suggestions have someone. */
export const devFollows: [string, string][] = [
  ['admin', 'learner1'],
  ['admin', 'learner2'],
  ['learner1', 'admin'],
  ['learner1', 'learner2'],
  ['learner2', 'admin'],
];

/** Text posts, newest last. `hoursAgo` spreads them over the last few days. */
export const devPosts: { key: string; author: string; topic: string; hoursAgo: number; caption: string }[] = [
  { key: 'backprop', author: 'admin', topic: 'Backpropagation', hoursAgo: 96, caption: 'Backprop is the chain rule, applied from the loss back to every weight. Our two-minute note in Learn walks through it.' },
  { key: 'pe', author: 'learner2', topic: 'Positional encoding', hoursAgo: 80, caption: 'Positional encodings: sine and cosine waves at different frequencies, added to each token so attention knows the order.' },
  { key: 'tokens', author: 'learner1', topic: 'Tokenisation', hoursAgo: 70, caption: 'Tokenizer-এর কারণে বাংলা টেক্সট ইংরেজির চেয়ে বেশি টোকেন খায়। তাই একই prompt বাংলায় লিখলে খরচ বেশি।' },
  { key: 'icl', author: 'admin', topic: 'In-context learning', hoursAgo: 60, caption: "GPT-3's trick isn't new weights, it's the prompt: give it a few examples and it adapts in context." },
  { key: 'residual', author: 'learner2', topic: 'Residual connections', hoursAgo: 50, caption: 'Residual block = output + input. That one addition is why 152-layer networks train at all.' },
  { key: 'bert', author: 'learner1', topic: 'Pre-training and fine-tuning', hoursAgo: 40, caption: 'Reading BERT this week. Masked language modelling is such a simple idea: hide 15% of the tokens and predict them from both sides.' },
  { key: 'lr', author: 'admin', topic: 'Gradient descent', hoursAgo: 30, caption: 'If your loss explodes in the first few steps, lower the learning rate before you change anything else.' },
  { key: 'overfit', author: 'learner2', topic: 'Overfitting and regularisation', hoursAgo: 22, caption: 'Training accuracy 99%, validation 71%. ক্লাসিক overfitting। Dropout 0.5 দিয়ে আবার চালাচ্ছি।' },
  { key: 'w2v', author: 'learner1', topic: 'Word embeddings', hoursAgo: 14, caption: 'word2vec still amazes me. king − man + woman ≈ queen, learned from nothing but predicting neighbouring words.' },
  { key: 'card', author: 'admin', topic: 'Transformers', hoursAgo: 8, caption: 'New in Research: the Attention Is All You Need card is now in Bangla too. Open Learn first if softmax is still fuzzy.' },
  { key: 'conv', author: 'learner2', topic: 'Convolutional neural networks', hoursAgo: 5, caption: 'আজ হাতে-কলমে convolution করলাম। 3×3 filter একটা 5×5 ছবির ওপর সরালে আউটপুট হয় 3×3; padding না দিলে ছবি ছোট হতে থাকে।' },
  { key: 'sqrt', author: 'learner1', topic: 'Attention mechanism', hoursAgo: 2, caption: 'Finally understood why attention divides by √d_k: without it the dot products grow with the dimension, softmax saturates and the gradients nearly vanish.' },
];

/** user → post keys they like. */
export const devLikes: Record<string, string[]> = {
  admin: ['sqrt', 'conv', 'w2v', 'overfit', 'bert', 'residual', 'tokens', 'pe'],
  learner1: ['card', 'lr', 'icl', 'backprop', 'conv', 'residual'],
  learner2: ['card', 'sqrt', 'lr', 'w2v', 'icl'],
};

/** Post comments; `replies` are answers to that comment. */
export const devComments: { post: string; author: string; body: string; replies?: { author: string; body: string }[] }[] = [
  {
    post: 'sqrt',
    author: 'learner2',
    body: 'Same here. The softmax lesson in Learn made it click for me.',
    replies: [{ author: 'learner1', body: 'Yes! The Attention basics quiz is a good check too.' }],
  },
  { post: 'sqrt', author: 'admin', body: 'Nicely put. Section 3.2.1 of the paper has the one-line reason in a footnote.' },
  {
    post: 'overfit',
    author: 'learner1',
    body: 'Try early stopping as well. Watch the validation loss and keep the best checkpoint.',
    replies: [{ author: 'learner2', body: 'ধন্যবাদ! validation loss দেখে থামালে অনেক ভালো হলো।' }],
  },
  { post: 'card', author: 'learner2', body: 'বাংলা কার্ডটা দারুণ। ResNet-এরটাও পড়লাম।' },
];

/** The paper discussion under "Attention Is All You Need". */
export const devPaperDiscussion: { author: string; body: string; replies?: { author: string; body: string }[] }[] = [
  {
    author: 'learner2',
    body: "Why is the decoder's self-attention masked?",
    replies: [{ author: 'admin', body: 'So each position can only look at earlier tokens: when the model generates text, the later tokens do not exist yet.' }],
  },
  { author: 'learner1', body: 'The ablation table on the number of heads is worth reading closely. One head is clearly worse, but too many hurts too.' },
];

export const devTrails: {
  author: string;
  title: string;
  description: string;
  lang: 'en' | 'bn';
  field: string;
  publish: boolean;
  steps: { paper: string; note: string }[];
}[] = [
  {
    author: 'learner1',
    title: 'From word vectors to GPT-3',
    description: 'Four papers that explain how today’s language models came to be.',
    lang: 'en',
    field: 'LLMs',
    publish: true,
    steps: [
      { paper: 'Efficient Estimation of Word Representations in Vector Space', note: 'Words become vectors.' },
      { paper: 'Attention Is All You Need', note: 'Attention replaces recurrence.' },
      { paper: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', note: 'Pre-train once, fine-tune for every task.' },
      { paper: 'Language Models are Few-Shot Learners', note: 'Skip fine-tuning: prompt a much bigger model.' },
    ],
  },
  {
    author: 'learner2',
    title: 'ছবির জন্য ট্রান্সফর্মার',
    description: 'ResNet থেকে ViT: ভিশন মডেল কীভাবে বদলাল, তিনটি পেপারে।',
    lang: 'bn',
    field: 'Computer vision',
    publish: true,
    steps: [
      { paper: 'Deep Residual Learning for Image Recognition', note: 'গভীর নেটওয়ার্ক কীভাবে ট্রেন হয়, এখান থেকে শুরু।' },
      { paper: 'Attention Is All You Need', note: 'Transformer-এর মূল নকশা।' },
      { paper: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale', note: 'ছবিকে প্যাচের বাক্য হিসেবে পড়া।' },
    ],
  },
  {
    author: 'admin',
    title: 'Optimisation essentials',
    description: 'Two papers on making training work. Still a draft.',
    lang: 'en',
    field: 'ML fundamentals',
    publish: false,
    steps: [
      { paper: 'Adam: A Method for Stochastic Optimization', note: 'The default optimiser.' },
      { paper: 'Dropout: A Simple Way to Prevent Neural Networks from Overfitting', note: 'The default regulariser.' },
    ],
  },
];

/** Each dev user's research state: interests, saved papers, reading steps, known topics and finished lessons. */
export const devReading: Record<
  string,
  {
    interests: string[];
    saves: string[];
    reading: { paper: string; step: 1 | 2 | 3; note?: string }[];
    known: string[];
    completed: string[];
    course?: { title: string; position: number };
  }
> = {
  admin: {
    interests: ['Transformers', 'LLMs'],
    saves: ['Language Models are Few-Shot Learners', 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale', 'Attention Is All You Need'],
    reading: [
      { paper: 'Attention Is All You Need', step: 2, note: 'Re-read 3.2 on multi-head attention. Check why d_k = d_model / h.' },
      { paper: 'Adam: A Method for Stochastic Optimization', step: 1 },
    ],
    known: ['Softmax'],
    completed: ['Gradient descent in one minute'],
    course: { title: 'Foundations for reading Transformer papers', position: 2 },
  },
  learner1: {
    interests: ['LLMs'],
    saves: ['BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding'],
    reading: [{ paper: 'Efficient Estimation of Word Representations in Vector Space', step: 3 }],
    known: [],
    completed: [],
  },
};

/** Notifications for the default dev user (admin), as the actions above would have created them. */
export const devNotifications: { to: string; actor: string; type: 'follow' | 'like' | 'comment' | 'reply'; post?: string; read: boolean; hoursAgo: number }[] = [
  { to: 'admin', actor: 'learner2', type: 'follow', read: true, hoursAgo: 100 },
  { to: 'admin', actor: 'learner1', type: 'like', post: 'lr', read: true, hoursAgo: 20 },
  { to: 'admin', actor: 'learner2', type: 'like', post: 'card', read: false, hoursAgo: 6 },
  { to: 'admin', actor: 'learner2', type: 'comment', post: 'card', read: false, hoursAgo: 4 },
  { to: 'admin', actor: 'learner1', type: 'like', post: 'card', read: false, hoursAgo: 3 },
];
