import { SimulatedMetrics, SimulatedPublisher, TemplateAssistant, type ContentAssistant, type MetricsProvider, type SocialPublisher } from '@ms/core';
import type { Config } from '../config.js';
import { AyrsharePublisher } from './ayrshare-publisher.js';
import { ClaudeAssistant } from './claude-assistant.js';

export function selectAdapters(cfg: Pick<Config, 'anthropicApiKey' | 'aiModel' | 'publisher' | 'ayrshareApiKey'>): {
  assistant: ContentAssistant;
  publisher: SocialPublisher;
  metrics: MetricsProvider;
} {
  const assistant = cfg.anthropicApiKey
    ? new ClaudeAssistant({ apiKey: cfg.anthropicApiKey, model: cfg.aiModel })
    : new TemplateAssistant();
  const publisher = cfg.publisher === 'ayrshare' ? new AyrsharePublisher(cfg.ayrshareApiKey) : new SimulatedPublisher();
  return { assistant, publisher, metrics: new SimulatedMetrics() };
}
