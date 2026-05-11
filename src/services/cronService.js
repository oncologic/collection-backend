import cron from 'node-cron';

class CronService {
  constructor() {
    this.jobs = new Map();
  }

  // Initialize all cron jobs
  init() {
    console.log('Cron service initialized');
  }

  // Add a new cron job
  addJob(name, schedule, handler) {
    if (this.jobs.has(name)) {
      this.jobs.get(name).stop();
    }

    const job = cron.schedule(schedule, handler, {
      scheduled: true,
      timezone: 'America/New_York',
    });

    this.jobs.set(name, job);
    console.log(`Cron job '${name}' scheduled: ${schedule}`);
  }

  // Stop a specific job
  stopJob(name) {
    if (this.jobs.has(name)) {
      this.jobs.get(name).stop();
      this.jobs.delete(name);
      console.log(`Cron job '${name}' stopped`);
    }
  }

  // Stop all jobs
  stopAll() {
    this.jobs.forEach((job, name) => {
      job.stop();
      console.log(`Cron job '${name}' stopped`);
    });
    this.jobs.clear();
  }
}

// Create singleton instance
const cronService = new CronService();

export default cronService;
