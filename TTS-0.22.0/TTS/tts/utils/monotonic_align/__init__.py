import numpy as np
import torch


def maximum_path(value, mask):
    """Pure Python fallback for monotonic alignment (no C extension needed)."""
    value = value * mask
    device = value.device
    dtype = value.dtype
    value = value.cpu().detach().numpy().astype(np.float32)
    mask = mask.cpu().detach().numpy().astype(np.int32)
    b, t_x, t_y = value.shape
    direction = np.zeros(value.shape, dtype=np.int32)
    v = np.zeros((b, t_x), dtype=np.float32)
    x_range = np.arange(t_x, dtype=np.float32).reshape(1, -1)
    for j in range(t_y):
        v0 = np.pad(v, [[0, 0], [1, 0]], constant_values=-np.inf)[:, :-1]
        v1 = v
        max_mask = v1 >= v0
        v_max = np.where(max_mask, v1, v0)
        direction[:, :, j] = max_mask
        index_mask = x_range <= j
        v = np.where(index_mask, v_max + value[:, :, j], -np.inf)
    direction = np.where(mask, direction, 1)
    path = np.zeros(value.shape, dtype=np.float32)
    index = mask[:, :, 0].sum(1).astype(np.int32) - 1
    for j in reversed(range(t_y)):
        path[np.arange(b), index, j] = 1
        index = index + direction[np.arange(b), index, j] - 1
    return torch.from_numpy(path).to(device=device, dtype=dtype)
