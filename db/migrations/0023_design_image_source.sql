-- Where a Design thumbnail came from: 'upload' (a person chose a screenshot) or 'capture' (the server took it from the prototype
-- link). A link that changes may replace a captured picture on its own, never an uploaded one. A picture with no source (kept by
-- the previous code during a deploy) counts as an upload.
-- Backward compatible: the previous code ignores the column.

alter table delivery.design_items add column image_source text check (image_source in ('upload', 'capture'));
update delivery.design_items set image_source = 'upload' where image is not null;
