#!/usr/bin/env bash
# Place in .platform/hooks/postdeploy directory
sudo certbot -n -d pastime.is404.net --nginx --agree-tos --email ejoaquin@byu.edu