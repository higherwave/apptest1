-- Where each AI call actually ran ("us" or "global"), as the provider reported it. Lets us show, call by call, that customer text was processed in
-- the United States, and prices the call correctly (US-only inference costs 1.1 times the global rate). Null for calls made before this existed.
alter table core.ai_usage add column inference_geo text;
