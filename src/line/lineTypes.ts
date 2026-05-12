export interface LineTextMessage {
  id: string;
  type: 'text';
  text: string;
}

export interface LineSource {
  type: 'user' | 'group' | 'room';
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface LineEvent {
  type: string;
  message?: LineTextMessage;
  source: LineSource;
  replyToken?: string;
  timestamp: number;
  webhookEventId?: string;
  deliveryContext?: {
    isRedelivery: boolean;
  };
}

export interface LineWebhookBody {
  destination: string;
  events: LineEvent[];
}
