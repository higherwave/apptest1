drop table delivery.launch_slack_posts;
alter table delivery.launches drop column slack_permalink, drop column slack_thread_ts, drop column slack_channel_id;
alter table core.teams drop column slack_channel;
