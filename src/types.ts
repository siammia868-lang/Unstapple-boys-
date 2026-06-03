/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface User {
  uid: string;
  username: string;
  photoURL: string;
  email: string;
  lastActive: string; // ISO string
  latitude?: number;
  longitude?: number;
  locationSharedAt?: string; // ISO string
  shareLocationEnabled: boolean;
  statusText?: string;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  createdAt: string; // ISO string
  isDefault: boolean;
}

export interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  senderPhoto: string;
  createdAt: string; // ISO string
  messageType: 'text' | 'image' | 'location';
  imageUrl?: string;
  locationName?: string;
  latitude?: number;
  longitude?: number;
  reactions?: Record<string, string[]>;
}

export interface StreamEvent {
  type: 'initial' | 'message' | 'user_update' | 'group_created' | 'typing';
  data: any;
}
