// Initialize the model.
const STEPS_PER_QUARTER = 24;
const BPM = 40;
const TEMP = 0.5;
const tf = mm.tf;

const N_PARAMS = 12;
const P_SIZE = 6;

const music_vae = new mm.MusicVAE('static/checkpoint');
const vaePlayer = new mm.Player();

const bgCols = ["#d93939", "#d93f3b", "#da4f3d", "#dc6a3f", "#e08f42",
                "#e7c245", "#eadf46", "#beee48", "#7ff149", "#4af254"]

const barCols = ["#b8fffd", "#a8fefd", "#98fbfd", "#89f4fc", "#7aebfa", "#6dddf8", "#62ccf5", "#58b6f1",
                 "#4f9bed", "#487de8", "#415ae2", "#423cdb", "#5e37d4", "#7833cb", "#902fc3", "#a52cba"]

let origin = null;
let vectors = [];

/// IGA Stuff comes here ///

class Population {
  constructor(m) {
    this.candidates = [];
    for (var i = 0; i < m; i++) {
      this.candidates.push(new Candidate());
    }
    this.current = 0;
    this.generation = 0;
  }

  stepWithFitness(fitness) {
    // Finish a sound and report its quality
    this.candidates[this.current].fitness = fitness;

    if (this.current < this.candidates.length - 1) {
      this.current ++;
    } else {
      this.evolve();
      this.current = 0;
    }

    return this.candidates[this.current].DNA;
  }

  evolve() {
    let newCandidates = [];

    while (newCandidates.length < this.candidates.length) {
      let child = this.crossover(this.rouletteSelect(), this.rouletteSelect());
      this.mutate(child);
      newCandidates.push(child);
    }

    this.candidates = newCandidates;
    this.generation ++;
  }

  crossover(c1, c2) {
    const dna = []
    const mid = Math.floor(Math.random() * c1.DNA.shape)
    for (let i = 0; i < c1.DNA.shape; i++) {
      if (Math.random() < .15) {
        // Pick middle at random spots
        dna.push((c2.DNA.bufferSync().get(i) + c1.DNA.bufferSync().get(i)) / 2);
      } else if (i > mid) {
        dna.push(c2.DNA.bufferSync().get(i));
      } else {
        dna.push(c1.DNA.bufferSync().get(i));
      }
    }

    const child = new Candidate();
    child.DNA = tf.tensor(dna);
    return child;
  }

  mutate(cand) {
    for (let i = 0; i < cand.DNA.shape; i++) {
      if (Math.random() < .05) {
        cand.DNA = cand.DNA.bufferSync();
        cand.DNA.set(Math.random() * 2 - 1, i)
        cand.DNA = cand.DNA.toTensor();
      }
    }
  }

  rouletteSelect() {
    let sum = 0;
    this.candidates.forEach((cand) => sum += cand.fitness);
    let pick = Math.random() * sum;
    for(let i = 0; i < this.candidates.length; i++) {
      let cand = this.candidates[i];
      if (pick < cand.fitness) {
        return cand;
      }
      pick -= cand.fitness;
    }
  }
}

class Candidate {

  constructor() {
    const SIZE = N_PARAMS;
    this.DNA = tf.randomNormal([N_PARAMS], 0, 1);
    this.fitness = null;
  }

}


document.addEventListener("DOMContentLoaded", function(event) {
  const spinner = document.getElementById('spinner');
  const playBtn = document.getElementById('play-btn');
  const progress = document.getElementById('progress');
  progress.style.display = "none";
  const genSpan = document.getElementById('gen');
  const candSpan = document.getElementById('cand');
  playBtn.style.display = "none";
  const canvas = document.getElementById("canvas");

  canvas.width = canvas.clientWidth;
  const barWidth = (canvas.clientWidth / N_PARAMS) - 10;
  canvas.height = canvas.clientHeight;
  const ctx = canvas.getContext("2d");

  const modal = document.querySelector(".modal");
  const trigger = document.querySelector(".trigger");
  const closeButton = document.querySelector(".close-button");

  function toggleModal() {
      modal.classList.toggle("show-modal");
  }

  function windowOnClick(event) {
      if (event.target === modal) {
          toggleModal();
      }
  }

  trigger.addEventListener("click", toggleModal);
  closeButton.addEventListener("click", toggleModal);
  window.addEventListener("click", windowOnClick);

  function createSearchSpace() {
    // Randomly defines N_PARAMS search dimensions in the Z space.
    return music_vae.sample(N_PARAMS + 1, TEMP, ['G'], STEPS_PER_QUARTER, BPM)
      .then((sequences) => {
        const tasks = []

        tasks.push(music_vae.encode([sequences[0]], ['G']).then((z) => origin = z));
        for (let i = 1; i < N_PARAMS + 1; i++) {
          tasks.push(music_vae.encode([sequences[i]], ['G'])
            .then((loc) => {
              vectors.push(loc.sub(origin));
          }));
        }

        return Promise.all(tasks).then((vals) => {
          playBtn.style.display = 'initial';
          spinner.style.display = 'none';
          document.getElementById('warning').style.display = 'none';
        });
      });
  }

  function mouseMove(e) {
    const ind = Math.floor((e.clientX / canvas.clientWidth) * 10);
    document.body.style.background = bgCols[ind];
  }

  function createSound(params, vecs) {
    // Uses parameters
    spinner.style.display = 'initial';
    let z = origin;
    for (let i = 0; i < N_PARAMS; i++) {
      z = z.add(vecs[i].mul(tf.tensor([params.bufferSync().get(i)])));
    }

    const progression = [];
    const tasks = [];
    ['G', 'D', 'Em', 'C'].forEach((chord) => {
      tasks.push(music_vae.decode(z, TEMP, [chord], STEPS_PER_QUARTER, BPM)
        .then((sample) => progression.push(sample[0])));
    });
    Promise.all(tasks).then((vals) => {
      if (vaePlayer.isPlaying()) {
        vaePlayer.stop();
      }
      document.onmousemove = mouseMove;
      canvas.addEventListener('click', clickRate, false);
      spinner.style.display = 'none';
      gen.textContent = p.generation + 1;
      cand.textContent = p.current + 1;

      vaePlayer.start(mm.sequences.concatenate(progression));
      drawBars(params);
    });
  }

  function drawBars(params) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < N_PARAMS; i++) {
      drawBar(5 + i * (barWidth + 10), params.bufferSync().get(i) * 100, barCols[i]);
    }
  }

  function drawBar(offset, height, color){
      ctx.save();
      ctx.fillStyle = color;
      ctx.fillRect(offset, 2 * canvas.clientHeight / 3, barWidth, height);
      ctx.restore();
  }

  playBtn.onclick = ((e) => {
    playBtn.style.display = "none";
    progress.style.display = "";
    spinner.style.display = 'initial';
    setTimeout(function() {createSound(p.candidates[p.current].DNA, vectors)}, 10);
  });

  function clickRate(e) {
    // Registers clicks and sends a rating based on x-coordinates to IGA.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    document.body.style.background = "";
    spinner.style.display = 'initial';

    setTimeout(function() {createSound(p.stepWithFitness(e.clientX / canvas.clientWidth), vectors)}, 10);
  }

  music_vae.initialize().then(() => createSearchSpace());
  const p = new Population(P_SIZE);
});

